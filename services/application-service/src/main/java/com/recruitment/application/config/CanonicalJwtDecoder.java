package com.recruitment.application.config;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

/**
 * Verifies the canonical access-token contract issued by Auth Service.
 *
 * <p>The decoder intentionally does not use Nimbus' remote JWK source. The
 * project contract requires stricter URL, response-size, schema, key and cache
 * behavior than that generic client provides.</p>
 */
public final class CanonicalJwtDecoder implements JwtDecoder {
    private static final int MAX_TOKEN_BYTES = 8 * 1024;
    private static final int MAX_STATIC_KEY_BYTES = 64 * 1024;
    private static final int MAX_JWKS_BYTES = 32 * 1024;
    private static final int MAX_JWKS_KEYS = 16;
    private static final int MIN_RSA_BITS = 2_048;
    private static final int MAX_RSA_BITS = 8_192;
    private static final int MAX_KID_LENGTH = 128;
    private static final int MAX_ALLOWED_HOSTS = 32;
    private static final long MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L;
    private static final long MAX_RSA_EXPONENT = 0xffff_ffffL;
    private static final String JWKS_PATH =
        "/auth/.well-known/jwks.json";
    private static final Set<String> HEADER_FIELDS = Set.of(
        "alg",
        "kid",
        "typ"
    );
    private static final Set<String> JWK_FIELDS = Set.of(
        "alg",
        "e",
        "kid",
        "kty",
        "n",
        "use"
    );
    private static final Set<String> SYSTEM_ROLES = Set.of(
        "CANDIDATE",
        "RECRUITER",
        "ADMIN"
    );
    private static final Pattern COMPACT_JWT_PATTERN = Pattern.compile(
        "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"
    );
    private static final Pattern BASE64URL_PATTERN = Pattern.compile(
        "^[A-Za-z0-9_-]+$"
    );
    private static final Pattern CANONICAL_UUID_V4_PATTERN = Pattern.compile(
        "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-" +
        "[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    );
    private static final Pattern HOSTNAME_PATTERN = Pattern.compile(
        "^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" +
        "(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
    );
    private static final Pattern CONTENT_LENGTH_PATTERN = Pattern.compile(
        "^(?:0|[1-9][0-9]{0,4})$"
    );
    private static final ObjectMapper JSON = new ObjectMapper(
        JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build()
    ).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private final Settings settings;
    private final HttpClient httpClient;
    private final Clock clock;
    private final LongSupplier monotonicNanos;
    private final VerificationKey staticKey;
    private final Object jwksLock = new Object();

    private Map<String, RSAPublicKey> jwksKeys = Map.of();
    private long jwksExpiresAtNanos = Long.MIN_VALUE;
    private long jwksRefreshAllowedAtNanos = Long.MIN_VALUE;
    private CompletableFuture<Map<String, RSAPublicKey>> jwksRefresh;

    public CanonicalJwtDecoder(JwtVerificationProperties properties) {
        this(properties, null, Clock.systemUTC(), System::nanoTime);
    }

    CanonicalJwtDecoder(
        JwtVerificationProperties properties,
        HttpClient httpClient,
        Clock clock,
        LongSupplier monotonicNanos
    ) {
        this.settings = Settings.from(properties);
        this.httpClient = httpClient == null
            ? HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(settings.jwksTimeoutMs()))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build()
            : httpClient;
        this.clock = Objects.requireNonNull(clock, "clock is required");
        this.monotonicNanos = Objects.requireNonNull(
            monotonicNanos,
            "monotonic clock is required"
        );
        this.staticKey = settings.jwksUri() == null
            ? loadStaticKey(settings.publicKey(), settings.publicKeyPath())
            : null;
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        try {
            ParsedToken parsed = parseToken(token);
            RSAPublicKey key = resolveKey(parsed.keyId());
            verifySignature(token, key);
            ValidatedClaims claims = validateClaims(parsed.claims());
            return materializeJwt(token, parsed, claims);
        } catch (
            InvalidAccessTokenException |
            AuthKeyUnavailableException |
            AuthVerificationException exception
        ) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new AuthVerificationException();
        }
    }

    private ParsedToken parseToken(String token) {
        if (
            token == null ||
            token.getBytes(StandardCharsets.UTF_8).length > MAX_TOKEN_BYTES ||
            !COMPACT_JWT_PATTERN.matcher(token).matches()
        ) {
            throw new InvalidAccessTokenException();
        }

        String[] segments = token.split("\\.", -1);
        if (segments.length != 3) {
            throw new InvalidAccessTokenException();
        }

        byte[] headerBytes = decodeCanonicalBase64Url(segments[0]);
        byte[] claimsBytes = decodeCanonicalBase64Url(segments[1]);
        decodeCanonicalBase64Url(segments[2]);

        JsonNode header = parseJsonObject(headerBytes);
        if (!hasExactFields(header, HEADER_FIELDS)) {
            throw new InvalidAccessTokenException();
        }
        String algorithm = exactText(header, "alg");
        String type = exactText(header, "typ");
        String keyId = exactText(header, "kid");
        if (
            !"RS256".equals(algorithm) ||
            !"JWT".equals(type) ||
            keyId == null ||
            keyId.length() > MAX_KID_LENGTH ||
            !BASE64URL_PATTERN.matcher(keyId).matches()
        ) {
            throw new InvalidAccessTokenException();
        }

        JsonNode claims = parseJsonObject(claimsBytes);
        return new ParsedToken(header, claims, keyId);
    }

    private JsonNode parseJsonObject(byte[] encoded) {
        try {
            String decoded = decodeUtf8(encoded);
            JsonNode value = JSON.readTree(decoded);
            if (value == null || !value.isObject()) {
                throw new InvalidAccessTokenException();
            }
            return value;
        } catch (JsonProcessingException | CharacterCodingException exception) {
            throw new InvalidAccessTokenException();
        }
    }

    private RSAPublicKey resolveKey(String keyId) {
        if (staticKey != null) {
            if (!staticKey.keyId().equals(keyId)) {
                throw new InvalidAccessTokenException();
            }
            return staticKey.publicKey();
        }
        return resolveJwksKey(keyId);
    }

    private RSAPublicKey resolveJwksKey(String keyId) {
        CompletableFuture<Map<String, RSAPublicKey>> refresh;
        boolean refreshOwner = false;

        synchronized (jwksLock) {
            long now = monotonicNanos.getAsLong();
            boolean cacheFresh = now < jwksExpiresAtNanos;
            RSAPublicKey cached = jwksKeys.get(keyId);
            if (cacheFresh && cached != null) {
                return cached;
            }

            refresh = jwksRefresh;
            if (refresh == null) {
                if (now < jwksRefreshAllowedAtNanos) {
                    if (cacheFresh) {
                        throw new InvalidAccessTokenException();
                    }
                    throw new AuthKeyUnavailableException();
                }
                jwksRefreshAllowedAtNanos = deadline(
                    now,
                    settings.jwksRefreshCooldownMs()
                );
                refresh = new CompletableFuture<>();
                jwksRefresh = refresh;
                refreshOwner = true;
            }
        }

        if (refreshOwner) {
            performOwnedRefresh(refresh);
        }

        Map<String, RSAPublicKey> published = awaitRefresh(refresh);
        RSAPublicKey key = published.get(keyId);
        if (key == null) {
            throw new InvalidAccessTokenException();
        }
        return key;
    }

    private void performOwnedRefresh(
        CompletableFuture<Map<String, RSAPublicKey>> refresh
    ) {
        try {
            Map<String, RSAPublicKey> fetched = fetchJwks();
            synchronized (jwksLock) {
                jwksKeys = fetched;
                jwksExpiresAtNanos = deadline(
                    monotonicNanos.getAsLong(),
                    settings.jwksCacheTtlMs()
                );
            }
            refresh.complete(fetched);
        } catch (AuthKeyUnavailableException exception) {
            refresh.completeExceptionally(exception);
        } catch (RuntimeException exception) {
            refresh.completeExceptionally(new AuthVerificationException());
        } finally {
            synchronized (jwksLock) {
                if (jwksRefresh == refresh) {
                    jwksRefresh = null;
                }
            }
        }
    }

    private Map<String, RSAPublicKey> awaitRefresh(
        CompletableFuture<Map<String, RSAPublicKey>> refresh
    ) {
        try {
            return refresh.join();
        } catch (CompletionException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof AuthKeyUnavailableException unavailable) {
                throw unavailable;
            }
            if (cause instanceof AuthVerificationException internal) {
                throw internal;
            }
            throw new AuthVerificationException();
        }
    }

    private Map<String, RSAPublicKey> fetchJwks() {
        URI uri = settings.jwksUri();
        if (uri == null) {
            throw new AuthVerificationException();
        }

        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofMillis(settings.jwksTimeoutMs()))
                .header(
                    "Accept",
                    "application/json, application/jwk-set+json"
                )
                .header("Accept-Encoding", "identity")
                .header("Cache-Control", "no-store")
                .GET()
                .build();
        } catch (IllegalArgumentException exception) {
            throw new AuthVerificationException();
        }

        long requestDeadline = System.nanoTime() + Duration.ofMillis(
            settings.jwksTimeoutMs()
        ).toNanos();
        HttpResponse<InputStream> response;
        try {
            response = httpClient.send(
                request,
                HttpResponse.BodyHandlers.ofInputStream()
            );
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AuthKeyUnavailableException();
        } catch (IOException exception) {
            throw new AuthKeyUnavailableException();
        }

        InputStream body = response.body();
        if (body == null) {
            throw new AuthKeyUnavailableException();
        }
        try (body) {
            if (
                response.statusCode() != 200 ||
                !hasAllowedContentType(response) ||
                !hasIdentityEncoding(response) ||
                !hasAllowedContentLength(response)
            ) {
                throw new AuthKeyUnavailableException();
            }
            byte[] bytes = readBoundedBefore(
                body,
                MAX_JWKS_BYTES,
                requestDeadline
            );
            return parseJwks(bytes);
        } catch (AuthKeyUnavailableException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new AuthKeyUnavailableException();
        }
    }

    private Map<String, RSAPublicKey> parseJwks(byte[] bytes) {
        try {
            String decoded = decodeUtf8(bytes);
            JsonNode root = JSON.readTree(decoded);
            if (
                root == null ||
                !root.isObject() ||
                !hasExactFields(root, Set.of("keys"))
            ) {
                throw new AuthKeyUnavailableException();
            }
            JsonNode keys = root.get("keys");
            if (
                keys == null ||
                !keys.isArray() ||
                keys.isEmpty() ||
                keys.size() > MAX_JWKS_KEYS
            ) {
                throw new AuthKeyUnavailableException();
            }

            Map<String, RSAPublicKey> materialized = new LinkedHashMap<>();
            for (JsonNode value : keys) {
                ParsedJwk jwk = parseJwk(value);
                if (materialized.putIfAbsent(jwk.keyId(), jwk.key()) != null) {
                    throw new AuthKeyUnavailableException();
                }
            }
            return Collections.unmodifiableMap(materialized);
        } catch (
            JsonProcessingException |
            CharacterCodingException exception
        ) {
            throw new AuthKeyUnavailableException();
        }
    }

    private ParsedJwk parseJwk(JsonNode value) {
        if (!hasExactFields(value, JWK_FIELDS)) {
            throw new AuthKeyUnavailableException();
        }
        String algorithm = exactText(value, "alg");
        String exponent = exactText(value, "e");
        String keyId = exactText(value, "kid");
        String keyType = exactText(value, "kty");
        String modulus = exactText(value, "n");
        String use = exactText(value, "use");
        if (
            !"RS256".equals(algorithm) ||
            !"RSA".equals(keyType) ||
            !"sig".equals(use) ||
            keyId == null ||
            keyId.length() > MAX_KID_LENGTH ||
            !BASE64URL_PATTERN.matcher(keyId).matches() ||
            modulus == null ||
            exponent == null
        ) {
            throw new AuthKeyUnavailableException();
        }

        try {
            byte[] modulusBytes = decodeCanonicalBase64UrlForKey(modulus);
            byte[] exponentBytes = decodeCanonicalBase64UrlForKey(exponent);
            RSAPublicKey publicKey = materializeRsaKey(
                modulusBytes,
                exponentBytes
            );
            String computedKeyId = thumbprint(modulus, exponent);
            if (!MessageDigest.isEqual(
                computedKeyId.getBytes(StandardCharsets.US_ASCII),
                keyId.getBytes(StandardCharsets.US_ASCII)
            )) {
                throw new AuthKeyUnavailableException();
            }
            return new ParsedJwk(keyId, publicKey);
        } catch (AuthKeyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException | GeneralSecurityException exception) {
            throw new AuthKeyUnavailableException();
        }
    }

    private void verifySignature(String token, RSAPublicKey key) {
        try {
            SignedJWT signed = SignedJWT.parse(token);
            if (!signed.verify(new RSASSAVerifier(key))) {
                throw new InvalidAccessTokenException();
            }
        } catch (ParseException | JOSEException exception) {
            throw new InvalidAccessTokenException();
        }
    }

    private ValidatedClaims validateClaims(JsonNode claims) {
        String issuer = exactText(claims, "iss");
        String audience = exactText(claims, "aud");
        String subject = exactText(claims, "sub");
        String tokenId = exactText(claims, "jti");
        String role = exactText(claims, "role");
        Long issuedAt = exactSafeInteger(claims.get("iat"));
        Long expiresAt = exactSafeInteger(claims.get("exp"));
        long now = clock.instant().getEpochSecond();

        if (
            !settings.issuer().equals(issuer) ||
            !settings.audience().equals(audience) ||
            subject == null ||
            !CANONICAL_UUID_V4_PATTERN.matcher(subject).matches() ||
            tokenId == null ||
            !CANONICAL_UUID_V4_PATTERN.matcher(tokenId).matches() ||
            role == null ||
            !SYSTEM_ROLES.contains(role) ||
            issuedAt == null ||
            expiresAt == null ||
            issuedAt > safeAdd(now, 60) ||
            expiresAt <= issuedAt ||
            expiresAt <= now
        ) {
            throw new InvalidAccessTokenException();
        }
        return new ValidatedClaims(
            subject,
            role,
            Instant.ofEpochSecond(issuedAt),
            Instant.ofEpochSecond(expiresAt)
        );
    }

    private Jwt materializeJwt(
        String token,
        ParsedToken parsed,
        ValidatedClaims validated
    ) {
        Map<String, Object> headers = new LinkedHashMap<>();
        parsed.header().fields().forEachRemaining(entry ->
            headers.put(entry.getKey(), jsonValue(entry.getValue()))
        );

        Map<String, Object> claims = new LinkedHashMap<>();
        parsed.claims().fields().forEachRemaining(entry ->
            claims.put(entry.getKey(), jsonValue(entry.getValue()))
        );
        claims.put("iat", validated.issuedAt());
        claims.put("exp", validated.expiresAt());

        return new Jwt(
            token,
            validated.issuedAt(),
            validated.expiresAt(),
            Collections.unmodifiableMap(headers),
            Collections.unmodifiableMap(claims)
        );
    }

    private static VerificationKey loadStaticKey(
        String inline,
        String keyPath
    ) {
        String pem;
        try {
            if (!inline.isEmpty()) {
                if (
                    inline.getBytes(StandardCharsets.UTF_8).length >
                    MAX_STATIC_KEY_BYTES
                ) {
                    throw new AuthConfigurationException();
                }
                pem = inline.replace("\\n", "\n");
            } else {
                try (InputStream input = Files.newInputStream(Path.of(keyPath))) {
                    pem = decodeUtf8(readBounded(input, MAX_STATIC_KEY_BYTES));
                }
            }
            RSAPublicKey publicKey = parsePemPublicKey(pem);
            validateRsaKey(publicKey);
            return new VerificationKey(thumbprint(publicKey), publicKey);
        } catch (
            IOException |
            GeneralSecurityException |
            RuntimeException exception
        ) {
            if (exception instanceof AuthConfigurationException configured) {
                throw configured;
            }
            throw new AuthConfigurationException();
        }
    }

    private static RSAPublicKey parsePemPublicKey(String pem)
        throws GeneralSecurityException {
        if (pem == null || pem.contains("PRIVATE KEY")) {
            throw new AuthConfigurationException();
        }
        String normalized = pem.trim();
        String begin = "-----BEGIN PUBLIC KEY-----";
        String end = "-----END PUBLIC KEY-----";
        if (!normalized.startsWith(begin) || !normalized.endsWith(end)) {
            throw new AuthConfigurationException();
        }
        String body = normalized.substring(
            begin.length(),
            normalized.length() - end.length()
        );
        if (!body.matches("[A-Za-z0-9+/=\\r\\n]+")) {
            throw new AuthConfigurationException();
        }
        String compact = body.replace("\r", "").replace("\n", "");
        byte[] der = Base64.getDecoder().decode(compact);
        Object key = KeyFactory.getInstance("RSA").generatePublic(
            new X509EncodedKeySpec(der)
        );
        if (!(key instanceof RSAPublicKey rsa)) {
            throw new AuthConfigurationException();
        }
        return rsa;
    }

    private static RSAPublicKey materializeRsaKey(
        byte[] modulusBytes,
        byte[] exponentBytes
    ) throws GeneralSecurityException {
        if (
            modulusBytes.length == 0 ||
            modulusBytes[0] == 0 ||
            exponentBytes.length == 0 ||
            exponentBytes.length > 4 ||
            exponentBytes[0] == 0
        ) {
            throw new GeneralSecurityException("invalid RSA integers");
        }
        BigInteger modulus = new BigInteger(1, modulusBytes);
        BigInteger exponent = new BigInteger(1, exponentBytes);
        if (
            modulus.bitLength() < MIN_RSA_BITS ||
            modulus.bitLength() > MAX_RSA_BITS ||
            !modulus.testBit(0) ||
            exponent.compareTo(BigInteger.valueOf(3)) < 0 ||
            exponent.compareTo(BigInteger.valueOf(MAX_RSA_EXPONENT)) > 0 ||
            !exponent.testBit(0)
        ) {
            throw new GeneralSecurityException("invalid RSA key");
        }
        Object key = KeyFactory.getInstance("RSA").generatePublic(
            new RSAPublicKeySpec(modulus, exponent)
        );
        if (!(key instanceof RSAPublicKey rsa)) {
            throw new GeneralSecurityException("invalid RSA key type");
        }
        return rsa;
    }

    private static void validateRsaKey(RSAPublicKey key) {
        BigInteger modulus = key.getModulus();
        BigInteger exponent = key.getPublicExponent();
        if (
            modulus == null ||
            modulus.bitLength() < MIN_RSA_BITS ||
            modulus.bitLength() > MAX_RSA_BITS ||
            !modulus.testBit(0) ||
            exponent == null ||
            exponent.compareTo(BigInteger.valueOf(3)) < 0 ||
            exponent.compareTo(BigInteger.valueOf(MAX_RSA_EXPONENT)) > 0 ||
            !exponent.testBit(0)
        ) {
            throw new AuthConfigurationException();
        }
    }

    private static String thumbprint(RSAPublicKey key) {
        String modulus = encodeBase64Url(unsignedBytes(key.getModulus()));
        String exponent = encodeBase64Url(
            unsignedBytes(key.getPublicExponent())
        );
        return thumbprint(modulus, exponent);
    }

    private static String thumbprint(String modulus, String exponent) {
        String canonical = "{\"e\":\"" + exponent +
            "\",\"kty\":\"RSA\",\"n\":\"" + modulus + "\"}";
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                canonical.getBytes(StandardCharsets.US_ASCII)
            );
            return encodeBase64Url(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new AuthVerificationException();
        }
    }

    private static byte[] unsignedBytes(BigInteger value) {
        byte[] encoded = value.toByteArray();
        if (encoded.length > 1 && encoded[0] == 0) {
            byte[] unsigned = new byte[encoded.length - 1];
            System.arraycopy(encoded, 1, unsigned, 0, unsigned.length);
            return unsigned;
        }
        return encoded;
    }

    private static byte[] decodeCanonicalBase64Url(String value) {
        try {
            if (
                value == null ||
                !BASE64URL_PATTERN.matcher(value).matches()
            ) {
                throw new InvalidAccessTokenException();
            }
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            if (
                decoded.length == 0 ||
                !encodeBase64Url(decoded).equals(value)
            ) {
                throw new InvalidAccessTokenException();
            }
            return decoded;
        } catch (IllegalArgumentException exception) {
            throw new InvalidAccessTokenException();
        }
    }

    private static byte[] decodeCanonicalBase64UrlForKey(String value) {
        if (value == null || !BASE64URL_PATTERN.matcher(value).matches()) {
            throw new AuthKeyUnavailableException();
        }
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            if (
                decoded.length == 0 ||
                !encodeBase64Url(decoded).equals(value)
            ) {
                throw new AuthKeyUnavailableException();
            }
            return decoded;
        } catch (IllegalArgumentException exception) {
            throw new AuthKeyUnavailableException();
        }
    }

    private static String encodeBase64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static String decodeUtf8(byte[] value)
        throws CharacterCodingException {
        CharBuffer decoded = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(value));
        return decoded.toString();
    }

    private static byte[] readBounded(InputStream input, int maximum)
        throws IOException {
        byte[] bytes = input.readNBytes(maximum + 1);
        if (bytes.length > maximum) {
            throw new IOException("bounded input exceeded");
        }
        return bytes;
    }

    private static byte[] readBoundedBefore(
        InputStream input,
        int maximum,
        long deadlineNanos
    ) {
        long remaining = deadlineNanos - System.nanoTime();
        if (remaining <= 0) {
            closeQuietly(input);
            throw new AuthKeyUnavailableException();
        }

        FutureTask<byte[]> read = new FutureTask<>(() ->
            readBounded(input, maximum)
        );
        Thread.ofVirtual()
            .name("application-jwks-body-reader")
            .start(read);
        try {
            return read.get(remaining, TimeUnit.NANOSECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            closeQuietly(input);
            read.cancel(true);
            throw new AuthKeyUnavailableException();
        } catch (TimeoutException exception) {
            closeQuietly(input);
            read.cancel(true);
            throw new AuthKeyUnavailableException();
        } catch (ExecutionException exception) {
            throw new AuthKeyUnavailableException();
        } finally {
            if (!read.isDone()) {
                closeQuietly(input);
                read.cancel(true);
            }
        }
    }

    private static void closeQuietly(InputStream input) {
        try {
            input.close();
        } catch (IOException exception) {
            // The public error stays sanitized when cancellation itself fails.
        }
    }

    private static boolean hasExactFields(
        JsonNode value,
        Set<String> expected
    ) {
        if (value == null || !value.isObject() || value.size() != expected.size()) {
            return false;
        }
        Set<String> actual = new HashSet<>();
        value.fieldNames().forEachRemaining(actual::add);
        return actual.equals(expected);
    }

    private static String exactText(JsonNode object, String field) {
        JsonNode value = object == null ? null : object.get(field);
        return value != null && value.isTextual() ? value.textValue() : null;
    }

    private static Long exactSafeInteger(JsonNode value) {
        if (value == null || !value.isIntegralNumber()) {
            return null;
        }
        BigInteger integer = value.bigIntegerValue();
        BigInteger bound = BigInteger.valueOf(MAX_SAFE_JSON_INTEGER);
        if (
            integer.compareTo(bound.negate()) < 0 ||
            integer.compareTo(bound) > 0
        ) {
            return null;
        }
        return integer.longValue();
    }

    private static Object jsonValue(JsonNode value) {
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isTextual()) {
            return value.textValue();
        }
        if (value.isBoolean()) {
            return value.booleanValue();
        }
        if (value.isIntegralNumber()) {
            BigInteger integer = value.bigIntegerValue();
            return integer.bitLength() < 63 ? integer.longValue() : integer;
        }
        if (value.isFloatingPointNumber()) {
            return value.decimalValue();
        }
        if (value.isArray()) {
            List<Object> result = new ArrayList<>();
            value.forEach(item -> result.add(jsonValue(item)));
            return Collections.unmodifiableList(result);
        }
        if (value.isObject()) {
            Map<String, Object> result = new LinkedHashMap<>();
            value.fields().forEachRemaining(entry ->
                result.put(entry.getKey(), jsonValue(entry.getValue()))
            );
            return Collections.unmodifiableMap(result);
        }
        throw new AuthVerificationException();
    }

    private static boolean hasAllowedContentType(
        HttpResponse<?> response
    ) {
        List<String> values = response.headers().allValues("content-type");
        if (values.size() != 1) {
            return false;
        }
        String[] parts = values.getFirst().split(";", -1);
        String mediaType = parts[0].trim().toLowerCase(Locale.ROOT);
        if (
            !mediaType.equals("application/json") &&
            !mediaType.equals("application/jwk-set+json")
        ) {
            return false;
        }
        if (parts.length == 1) {
            return true;
        }
        if (parts.length != 2) {
            return false;
        }
        String[] parameter = parts[1].split("=", -1);
        if (
            parameter.length != 2 ||
            !parameter[0].trim().equalsIgnoreCase("charset")
        ) {
            return false;
        }
        String charset = parameter[1].trim();
        if (
            charset.length() >= 2 &&
            charset.startsWith("\"") &&
            charset.endsWith("\"")
        ) {
            charset = charset.substring(1, charset.length() - 1);
        }
        return charset.equalsIgnoreCase("utf-8") ||
            charset.equalsIgnoreCase("utf8");
    }

    private static boolean hasIdentityEncoding(HttpResponse<?> response) {
        List<String> values = response.headers().allValues("content-encoding");
        return values.isEmpty() ||
            (values.size() == 1 && values.getFirst().trim().equalsIgnoreCase(
                "identity"
            ));
    }

    private static boolean hasAllowedContentLength(
        HttpResponse<?> response
    ) {
        List<String> values = response.headers().allValues("content-length");
        if (values.isEmpty()) {
            return true;
        }
        if (values.size() != 1) {
            return false;
        }
        String value = values.getFirst();
        return CONTENT_LENGTH_PATTERN.matcher(value).matches() &&
            Long.parseLong(value) <= MAX_JWKS_BYTES;
    }

    private static long deadline(long now, int durationMs) {
        long duration = Duration.ofMillis(durationMs).toNanos();
        if (now > Long.MAX_VALUE - duration) {
            return Long.MAX_VALUE;
        }
        return now + duration;
    }

    private static long safeAdd(long value, long increment) {
        return value > Long.MAX_VALUE - increment
            ? Long.MAX_VALUE
            : value + increment;
    }

    private record ParsedToken(
        JsonNode header,
        JsonNode claims,
        String keyId
    ) {}

    private record ParsedJwk(String keyId, RSAPublicKey key) {}

    private record VerificationKey(
        String keyId,
        RSAPublicKey publicKey
    ) {}

    private record ValidatedClaims(
        String subject,
        String role,
        Instant issuedAt,
        Instant expiresAt
    ) {}

    private record Settings(
        String issuer,
        String audience,
        String publicKey,
        String publicKeyPath,
        URI jwksUri,
        int jwksTimeoutMs,
        int jwksCacheTtlMs,
        int jwksRefreshCooldownMs
    ) {
        private static Settings from(JwtVerificationProperties properties) {
            if (properties == null) {
                throw new AuthConfigurationException();
            }
            String issuer = requiredVisible(properties.getIssuer());
            String audience = requiredVisible(properties.getAudience());
            String publicKey = optionalInline(properties.getPublicKey());
            String publicKeyPath = optionalExact(
                properties.getPublicKeyPath()
            );
            String rawJwksUri = optionalExact(properties.getJwksUri());

            int sources = 0;
            if (!publicKey.isEmpty()) sources++;
            if (!publicKeyPath.isEmpty()) sources++;
            if (!rawJwksUri.isEmpty()) sources++;
            if (sources != 1) {
                throw new AuthConfigurationException();
            }

            int timeout = boundedInteger(
                properties.getJwksTimeoutMs(),
                500,
                10_000
            );
            int cacheTtl = boundedInteger(
                properties.getJwksCacheTtlMs(),
                1_000,
                3_600_000
            );
            int cooldown = boundedInteger(
                properties.getJwksRefreshCooldownMs(),
                1_000,
                60_000
            );
            if (cooldown > cacheTtl) {
                throw new AuthConfigurationException();
            }

            URI uri = rawJwksUri.isEmpty()
                ? null
                : validateJwksUri(
                    rawJwksUri,
                    properties.getJwksAllowedHosts(),
                    properties.isAllowInsecureJwks()
                );
            return new Settings(
                issuer,
                audience,
                publicKey,
                publicKeyPath,
                uri,
                timeout,
                cacheTtl,
                cooldown
            );
        }

        private static String requiredVisible(String value) {
            if (
                value == null ||
                value.length() > 512 ||
                !isVisibleAscii(value)
            ) {
                throw new AuthConfigurationException();
            }
            return value;
        }

        private static String optionalInline(String value) {
            if (value == null || value.isEmpty()) {
                return "";
            }
            if (value.indexOf('\0') >= 0) {
                throw new AuthConfigurationException();
            }
            return value;
        }

        private static String optionalExact(String value) {
            if (value == null || value.isEmpty()) {
                return "";
            }
            if (
                !value.equals(value.trim()) ||
                value.indexOf('\0') >= 0
            ) {
                throw new AuthConfigurationException();
            }
            return value;
        }

        private static int boundedInteger(
            int value,
            int minimum,
            int maximum
        ) {
            if (value < minimum || value > maximum) {
                throw new AuthConfigurationException();
            }
            return value;
        }

        private static URI validateJwksUri(
            String raw,
            String rawAllowedHosts,
            boolean allowInsecure
        ) {
            if (
                !isVisibleAscii(raw) ||
                raw.contains("%") ||
                raw.contains("\\")
            ) {
                throw new AuthConfigurationException();
            }

            URI uri;
            try {
                uri = URI.create(raw);
            } catch (IllegalArgumentException exception) {
                throw new AuthConfigurationException();
            }
            String scheme = uri.getScheme();
            boolean allowedScheme = "https".equalsIgnoreCase(scheme) ||
                (allowInsecure && "http".equalsIgnoreCase(scheme));
            String host = canonicalHost(uri.getHost());
            Set<String> allowedHosts = allowedHosts(rawAllowedHosts);
            if (
                !allowedScheme ||
                host == null ||
                !allowedHosts.contains(host) ||
                uri.getRawUserInfo() != null ||
                !JWKS_PATH.equals(uri.getRawPath()) ||
                uri.getRawQuery() != null ||
                uri.getRawFragment() != null
            ) {
                throw new AuthConfigurationException();
            }
            try {
                HttpRequest.newBuilder(uri).GET().build();
            } catch (IllegalArgumentException exception) {
                throw new AuthConfigurationException();
            }
            return uri;
        }

        private static Set<String> allowedHosts(String raw) {
            String value = optionalExact(raw);
            if (value.isEmpty()) {
                throw new AuthConfigurationException();
            }
            String[] entries = value.split(",", -1);
            if (entries.length > MAX_ALLOWED_HOSTS) {
                throw new AuthConfigurationException();
            }
            Set<String> hosts = new HashSet<>();
            for (String entry : entries) {
                String candidate = entry.trim();
                if (
                    candidate.isEmpty() ||
                    !candidate.equals(candidate.toLowerCase(Locale.ROOT)) ||
                    !isHostnameOrIp(candidate)
                ) {
                    throw new AuthConfigurationException();
                }
                String canonical = canonicalHost(candidate);
                if (canonical == null || !hosts.add(canonical)) {
                    throw new AuthConfigurationException();
                }
            }
            return Set.copyOf(hosts);
        }

        private static String canonicalHost(String value) {
            if (value == null || value.isEmpty()) {
                return null;
            }
            String result = value.toLowerCase(Locale.ROOT);
            if (result.startsWith("[") && result.endsWith("]")) {
                result = result.substring(1, result.length() - 1);
            }
            if (result.indexOf(':') >= 0) {
                return canonicalIpLiteral(result);
            }
            return result;
        }

        private static boolean isHostnameOrIp(String value) {
            if (HOSTNAME_PATTERN.matcher(value).matches()) {
                return true;
            }
            if (
                value.indexOf(':') < 0 ||
                !value.matches("[0-9a-f:.]+")
            ) {
                return false;
            }
            return canonicalIpLiteral(value) != null;
        }

        private static String canonicalIpLiteral(String value) {
            if (
                value == null ||
                value.indexOf(':') < 0 ||
                !value.matches("[0-9a-f:.]+")
            ) {
                return null;
            }
            try {
                return InetAddress.getByName(value)
                    .getHostAddress()
                    .toLowerCase(Locale.ROOT);
            } catch (UnknownHostException exception) {
                return null;
            }
        }

        private static boolean isVisibleAscii(String value) {
            if (value == null || value.isEmpty()) {
                return false;
            }
            for (int index = 0; index < value.length(); index++) {
                char character = value.charAt(index);
                if (character < 0x21 || character > 0x7e) {
                    return false;
                }
            }
            return true;
        }
    }

}
