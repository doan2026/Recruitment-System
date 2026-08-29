package com.recruitment.application.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class CanonicalJwtDecoderTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-08-29T00:00:00Z");
    private static final String ISSUER = "recruitment-auth";
    private static final String AUDIENCE = "recruitment-api";
    private static KeyPair firstKey;
    private static KeyPair secondKey;

    @BeforeAll
    static void generateKeys() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        firstKey = generator.generateKeyPair();
        secondKey = generator.generateKeyPair();
    }

    @Test
    void decodesCanonicalStaticTokenAndRejectsNonCanonicalClaims() throws Exception {
        CanonicalJwtDecoder decoder = new CanonicalJwtDecoder(
            staticProperties(firstKey), null,
            Clock.fixed(NOW, ZoneOffset.UTC), System::nanoTime
        );
        String valid = token(firstKey, canonicalClaims(), Map.of(
            "alg", "RS256", "kid", kid(firstKey), "typ", "JWT"
        ));

        Jwt decoded = decoder.decode(valid);

        assertThat(decoded.getSubject()).isEqualTo(
            "7c5f2d7a-a657-4d7d-88bf-bc5b60557159"
        );
        assertThat(decoded.getClaimAsString("role")).isEqualTo("RECRUITER");

        assertInvalid(decoder, token(firstKey, claimsWith("aud", List.of(AUDIENCE)), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, claimsWith("iat", NOW.getEpochSecond() + 61), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, claimsWith("role", "SUPER_ADMIN"), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, claimsWith("sub", UUID.randomUUID().toString().toUpperCase()), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, canonicalClaims(), Map.of(
            "alg", "RS256", "kid", kid(firstKey), "typ", "jwt"
        )));
    }

    @Test
    void configurationRequiresExactlyOneTrustedKeySource() throws Exception {
        JwtVerificationProperties none = baseProperties();
        assertThatThrownBy(() -> new CanonicalJwtDecoder(none))
            .isExactlyInstanceOf(AuthConfigurationException.class)
            .hasMessage("JWT verification is not configured safely");

        JwtVerificationProperties ambiguous = staticProperties(firstKey);
        ambiguous.setJwksUri("https://auth.example.com/auth/.well-known/jwks.json");
        ambiguous.setJwksAllowedHosts("auth.example.com");
        assertThatThrownBy(() -> new CanonicalJwtDecoder(ambiguous))
            .isExactlyInstanceOf(AuthConfigurationException.class);

        JwtVerificationProperties unsafe = jwksProperties();
        unsafe.setJwksUri("https://evil.example.com/auth/.well-known/jwks.json");
        assertThatThrownBy(() -> new CanonicalJwtDecoder(unsafe))
            .isExactlyInstanceOf(AuthConfigurationException.class);
    }

    @Test
    void cachesKnownKeyAndSuppressesUnknownKidRefreshDuringCooldown() throws Exception {
        AtomicLong nanos = new AtomicLong();
        StubHttpClient client = new StubHttpClient();
        client.enqueue(response(200, jwks(firstKey), Map.of("content-type", List.of("application/jwk-set+json"))));
        CanonicalJwtDecoder decoder = jwksDecoder(client, nanos);

        decoder.decode(token(firstKey, canonicalClaims(), canonicalHeader(firstKey)));
        decoder.decode(token(firstKey, canonicalClaims(), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(secondKey, canonicalClaims(), canonicalHeader(secondKey)));

        assertThat(client.calls()).isEqualTo(1);
    }

    @Test
    void rotatesKeysAfterTtlAndDoesNotAcceptRemovedKey() throws Exception {
        AtomicLong nanos = new AtomicLong();
        StubHttpClient client = new StubHttpClient();
        client.enqueue(response(200, jwks(firstKey), jsonHeaders()));
        client.enqueue(response(200, jwks(secondKey), jsonHeaders()));
        CanonicalJwtDecoder decoder = jwksDecoder(client, nanos);

        decoder.decode(token(firstKey, canonicalClaims(), canonicalHeader(firstKey)));
        nanos.set(TimeUnit.MILLISECONDS.toNanos(1_001));
        decoder.decode(token(secondKey, canonicalClaims(), canonicalHeader(secondKey)));
        assertInvalid(decoder, token(firstKey, canonicalClaims(), canonicalHeader(firstKey)));

        assertThat(client.calls()).isEqualTo(2);
    }

    @Test
    void expiredCacheIsNeverUsedWhenRefreshFails() throws Exception {
        AtomicLong nanos = new AtomicLong();
        StubHttpClient client = new StubHttpClient();
        client.enqueue(response(200, jwks(firstKey), jsonHeaders()));
        client.enqueue(new IOException("secret upstream detail"));
        CanonicalJwtDecoder decoder = jwksDecoder(client, nanos);
        String token = token(firstKey, canonicalClaims(), canonicalHeader(firstKey));
        decoder.decode(token);

        nanos.set(TimeUnit.MILLISECONDS.toNanos(1_001));

        assertThatThrownBy(() -> decoder.decode(token))
            .isExactlyInstanceOf(AuthKeyUnavailableException.class)
            .hasMessage("Auth signing keys are unavailable")
            .hasMessageNotContaining("secret");
        assertThat(client.calls()).isEqualTo(2);
    }

    @Test
    void concurrentColdCacheMissesUseOneJwksRequest() throws Exception {
        AtomicLong nanos = new AtomicLong();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        StubHttpClient client = new StubHttpClient();
        String jwksBody = jwks(firstKey);
        client.enqueue(() -> {
            entered.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) {
                throw new IOException("test timed out");
            }
            return response(200, jwksBody, jsonHeaders());
        });
        CanonicalJwtDecoder decoder = jwksDecoder(client, nanos);
        String token = token(firstKey, canonicalClaims(), canonicalHeader(firstKey));

        try (var executor = Executors.newFixedThreadPool(6)) {
            var futures = java.util.stream.IntStream.range(0, 6)
                .mapToObj(ignored -> executor.submit(() -> decoder.decode(token)))
                .toList();
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            release.countDown();
            for (var future : futures) {
                assertThat(future.get(5, TimeUnit.SECONDS).getSubject()).isNotBlank();
            }
        }
        assertThat(client.calls()).isEqualTo(1);
    }

    @Test
    void rejectsJwksTransportMetadataAndOversizedBody() throws Exception {
        for (HttpResponse<InputStream> invalid : List.of(
            response(302, jwks(firstKey), jsonHeaders()),
            response(200, jwks(firstKey), Map.of("content-type", List.of("text/html"))),
            response(200, jwks(firstKey), Map.of(
                "content-type", List.of("application/json"),
                "content-encoding", List.of("gzip")
            )),
            response(200, "x".repeat(32 * 1024 + 1), jsonHeaders())
        )) {
            StubHttpClient client = new StubHttpClient();
            client.enqueue(invalid);
            CanonicalJwtDecoder decoder = jwksDecoder(client, new AtomicLong());
            assertThatThrownBy(() -> decoder.decode(
                token(firstKey, canonicalClaims(), canonicalHeader(firstKey))
            )).isExactlyInstanceOf(AuthKeyUnavailableException.class);
        }
    }

    @Test
    void rejectsWrongSignatureExtraHeaderMalformedAndOversizedTokens() throws Exception {
        CanonicalJwtDecoder decoder = new CanonicalJwtDecoder(
            staticProperties(firstKey), null,
            Clock.fixed(NOW, ZoneOffset.UTC), System::nanoTime
        );
        assertInvalid(decoder, token(secondKey, canonicalClaims(), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, canonicalClaims(), Map.of(
            "alg", "RS256", "kid", kid(firstKey), "typ", "JWT", "x5u", "https://evil"
        )));
        assertInvalid(decoder, "not.a.jwt");
        assertInvalid(decoder, "a".repeat(8 * 1024 + 1) + ".a.a");

        assertInvalid(decoder, token(firstKey, claimsWith("iat", 1.5), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, claimsWith("jti", "6903418d-ca47-1dc1-bd49-f8844254400b"), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, claimsWith("role", List.of("RECRUITER")), canonicalHeader(firstKey)));
        assertInvalid(decoder, token(firstKey, claimsWith("exp", NOW.getEpochSecond()), canonicalHeader(firstKey)));
    }

    @Test
    void acceptsCurrentAndPreviousJwksKeysFromOneFetchAndSendsStrictRequestHeaders() throws Exception {
        StubHttpClient client = new StubHttpClient();
        client.enqueue(response(200, jwks(firstKey, secondKey), jsonHeaders()));
        CanonicalJwtDecoder decoder = jwksDecoder(client, new AtomicLong());

        decoder.decode(token(firstKey, canonicalClaims(), canonicalHeader(firstKey)));
        decoder.decode(token(secondKey, canonicalClaims(), canonicalHeader(secondKey)));

        assertThat(client.calls()).isEqualTo(1);
        assertThat(client.lastRequest().uri()).isEqualTo(
            URI.create("https://auth.example.com/auth/.well-known/jwks.json")
        );
        assertThat(client.lastRequest().headers().firstValue("Accept-Encoding"))
            .contains("identity");
        assertThat(client.lastRequest().headers().firstValue("Cache-Control"))
            .contains("no-store");
    }

    @Test
    void rejectsUnsafeJwksUrlsAndInvalidatesWholeMalformedJwksDocument() throws Exception {
        for (String uri : List.of(
            "http://auth.example.com/auth/.well-known/jwks.json",
            "https://user@auth.example.com/auth/.well-known/jwks.json",
            "https://auth.example.com/auth/.well-known/jwks.json?key=x"
        )) {
            JwtVerificationProperties properties = jwksProperties();
            properties.setJwksUri(uri);
            assertThatThrownBy(() -> new CanonicalJwtDecoder(properties))
                .isExactlyInstanceOf(AuthConfigurationException.class);
        }

        RSAPublicKey key = (RSAPublicKey) firstKey.getPublic();
        Map<String, String> badKey = Map.of(
            "kty", "RSA", "use", "sig", "alg", "RS256", "kid", "wrong",
            "n", b64(unsigned(key.getModulus())), "e", b64(unsigned(key.getPublicExponent()))
        );
        String invalid = JSON.writeValueAsString(Map.of("keys", List.of(badKey)));
        StubHttpClient client = new StubHttpClient();
        client.enqueue(response(200, invalid, jsonHeaders()));
        CanonicalJwtDecoder decoder = jwksDecoder(client, new AtomicLong());
        assertThatThrownBy(() -> decoder.decode(
            token(firstKey, canonicalClaims(), canonicalHeader(firstKey))
        )).isExactlyInstanceOf(AuthKeyUnavailableException.class);
    }

    private static CanonicalJwtDecoder jwksDecoder(StubHttpClient client, AtomicLong nanos) {
        return new CanonicalJwtDecoder(
            jwksProperties(), client, Clock.fixed(NOW, ZoneOffset.UTC), nanos::get
        );
    }

    private static JwtVerificationProperties baseProperties() {
        JwtVerificationProperties properties = new JwtVerificationProperties();
        properties.setIssuer(ISSUER);
        properties.setAudience(AUDIENCE);
        properties.setJwksCacheTtlMs(1_000);
        properties.setJwksRefreshCooldownMs(1_000);
        return properties;
    }

    private static JwtVerificationProperties staticProperties(KeyPair pair) {
        JwtVerificationProperties properties = baseProperties();
        properties.setPublicKey(pem((RSAPublicKey) pair.getPublic()));
        return properties;
    }

    private static JwtVerificationProperties jwksProperties() {
        JwtVerificationProperties properties = baseProperties();
        properties.setJwksUri("https://auth.example.com/auth/.well-known/jwks.json");
        properties.setJwksAllowedHosts("auth.example.com");
        return properties;
    }

    private static Map<String, Object> canonicalClaims() {
        return Map.of(
            "iss", ISSUER,
            "aud", AUDIENCE,
            "sub", "7c5f2d7a-a657-4d7d-88bf-bc5b60557159",
            "jti", "6903418d-ca47-4dc1-bd49-f8844254400b",
            "role", "RECRUITER",
            "iat", NOW.getEpochSecond(),
            "exp", NOW.plusSeconds(300).getEpochSecond()
        );
    }

    private static Map<String, Object> claimsWith(String name, Object value) {
        var claims = new java.util.LinkedHashMap<>(canonicalClaims());
        claims.put(name, value);
        return claims;
    }

    private static Map<String, Object> canonicalHeader(KeyPair pair) {
        return Map.of("alg", "RS256", "kid", kid(pair), "typ", "JWT");
    }

    private static String token(KeyPair pair, Map<String, Object> claims, Map<String, Object> header)
        throws Exception {
        String signingInput = b64(JSON.writeValueAsBytes(header)) + "." +
            b64(JSON.writeValueAsBytes(claims));
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign((RSAPrivateKey) pair.getPrivate());
        signature.update(signingInput.getBytes(StandardCharsets.US_ASCII));
        return signingInput + "." + b64(signature.sign());
    }

    private static void assertInvalid(CanonicalJwtDecoder decoder, String token) {
        assertThatThrownBy(() -> decoder.decode(token))
            .isExactlyInstanceOf(InvalidAccessTokenException.class)
            .hasMessage("Access token is invalid or expired");
    }

    private static String jwks(KeyPair... pairs) throws Exception {
        var keys = new java.util.ArrayList<Map<String, String>>();
        for (KeyPair pair : pairs) {
            RSAPublicKey key = (RSAPublicKey) pair.getPublic();
            keys.add(Map.of(
                "kty", "RSA", "use", "sig", "alg", "RS256",
                "kid", kid(pair), "n", b64(unsigned(key.getModulus())),
                "e", b64(unsigned(key.getPublicExponent()))
            ));
        }
        return JSON.writeValueAsString(Map.of("keys", keys));
    }

    private static String kid(KeyPair pair) {
        RSAPublicKey key = (RSAPublicKey) pair.getPublic();
        String n = b64(unsigned(key.getModulus()));
        String e = b64(unsigned(key.getPublicExponent()));
        try {
            return b64(MessageDigest.getInstance("SHA-256").digest(
                ("{\"e\":\"" + e + "\",\"kty\":\"RSA\",\"n\":\"" + n + "\"}")
                    .getBytes(StandardCharsets.US_ASCII)
            ));
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static byte[] unsigned(BigInteger value) {
        byte[] bytes = value.toByteArray();
        return bytes.length > 1 && bytes[0] == 0
            ? java.util.Arrays.copyOfRange(bytes, 1, bytes.length)
            : bytes;
    }

    private static String pem(RSAPublicKey key) {
        return "-----BEGIN PUBLIC KEY-----\n" +
            Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(key.getEncoded()) +
            "\n-----END PUBLIC KEY-----";
    }

    private static String b64(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static Map<String, List<String>> jsonHeaders() {
        return Map.of("content-type", List.of("application/json; charset=utf-8"));
    }

    @SuppressWarnings("unchecked")
    private static HttpResponse<InputStream> response(
        int status, String body, Map<String, List<String>> headers
    ) {
        HttpResponse<InputStream> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(status);
        when(response.headers()).thenReturn(HttpHeaders.of(headers, (name, value) -> true));
        when(response.body()).thenReturn(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        return response;
    }

    @FunctionalInterface
    private interface ResponseAction {
        HttpResponse<InputStream> execute() throws IOException, InterruptedException;
    }

    private static final class StubHttpClient extends HttpClient {
        private final Queue<ResponseAction> responses = new ConcurrentLinkedQueue<>();
        private final AtomicInteger calls = new AtomicInteger();
        private volatile HttpRequest lastRequest;

        void enqueue(HttpResponse<InputStream> response) {
            responses.add(() -> response);
        }

        void enqueue(IOException exception) {
            responses.add(() -> { throw exception; });
        }

        void enqueue(ResponseAction action) {
            responses.add(action);
        }

        int calls() { return calls.get(); }
        HttpRequest lastRequest() { return lastRequest; }

        @Override
        @SuppressWarnings("unchecked")
        public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
            throws IOException, InterruptedException {
            calls.incrementAndGet();
            lastRequest = request;
            ResponseAction action = responses.poll();
            if (action == null) throw new IOException("unexpected request");
            return (HttpResponse<T>) action.execute();
        }

        @Override public java.util.Optional<java.net.CookieHandler> cookieHandler() { return java.util.Optional.empty(); }
        @Override public java.util.Optional<Duration> connectTimeout() { return java.util.Optional.empty(); }
        @Override public Redirect followRedirects() { return Redirect.NEVER; }
        @Override public java.util.Optional<java.net.ProxySelector> proxy() { return java.util.Optional.empty(); }
        @Override public javax.net.ssl.SSLContext sslContext() { return null; }
        @Override public javax.net.ssl.SSLParameters sslParameters() { return new javax.net.ssl.SSLParameters(); }
        @Override public java.util.Optional<java.net.Authenticator> authenticator() { return java.util.Optional.empty(); }
        @Override public Version version() { return Version.HTTP_1_1; }
        @Override public java.util.Optional<java.util.concurrent.Executor> executor() { return java.util.Optional.empty(); }
        @Override public <T> java.util.concurrent.CompletableFuture<HttpResponse<T>> sendAsync(
            HttpRequest request, HttpResponse.BodyHandler<T> handler
        ) { throw new UnsupportedOperationException(); }
        @Override public <T> java.util.concurrent.CompletableFuture<HttpResponse<T>> sendAsync(
            HttpRequest request, HttpResponse.BodyHandler<T> handler,
            HttpResponse.PushPromiseHandler<T> pushPromiseHandler
        ) { throw new UnsupportedOperationException(); }
    }
}
