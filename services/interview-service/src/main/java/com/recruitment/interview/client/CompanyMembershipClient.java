package com.recruitment.interview.client;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.interview.api.BusinessException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class CompanyMembershipClient {
    static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final int MAX_BEARER_TOKEN_LENGTH = 8192;
    private static final Set<String> ENVELOPE_FIELDS = Set.of("data", "meta");
    private static final Set<String> MEMBERSHIP_FIELDS = Set.of(
        "companyId",
        "name",
        "verifiedStatus",
        "memberRole"
    );

    private final RestClient restClient;
    private final ObjectMapper strictMapper;

    @Autowired
    public CompanyMembershipClient(
        ObjectMapper mapper,
        @Value("${interview.company-client.base-url}")
            String baseUrl,
        @Value("${interview.company-client.allowed-hosts}")
            String allowedHosts,
        @Value("${interview.company-client.request-timeout-ms}")
            long timeoutMs
    ) {
        this(buildClient(baseUrl, allowedHosts, timeoutMs), mapper);
    }

    CompanyMembershipClient(RestClient restClient, ObjectMapper mapper) {
        this.restClient = restClient;
        this.strictMapper = mapper.copy()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS);
    }

    public RecruiterCompanyMembership resolve(
        UUID recruiterId,
        String bearerToken
    ) {
        if (recruiterId == null) {
            throw new IllegalArgumentException("recruiterId is required");
        }
        String authorization = authorization(bearerToken);
        try {
            CompanyMembershipPayload payload = restClient.get()
                .uri("/by-user/{userId}", recruiterId)
                .accept(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, authorization)
                .exchange((request, response) -> readResponse(
                    response.getStatusCode().value(),
                    response.getHeaders().getContentType(),
                    response.getBody().readNBytes(MAX_RESPONSE_BYTES + 1)
                ));
            return validate(payload);
        } catch (BusinessException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw unavailable();
        }
    }

    private CompanyMembershipPayload readResponse(
        int status,
        MediaType contentType,
        byte[] body
    ) throws IOException {
        if (status == HttpStatus.FORBIDDEN.value()
            || status == HttpStatus.NOT_FOUND.value()) {
            throw denied();
        }
        if (status != HttpStatus.OK.value()
            || contentType == null
            || !MediaType.APPLICATION_JSON.isCompatibleWith(contentType)
            || body.length > MAX_RESPONSE_BYTES) {
            throw unavailable();
        }

        JsonNode envelope = strictMapper.readTree(body);
        if (!hasExactFields(envelope, ENVELOPE_FIELDS)
            || !envelope.get("meta").isNull()) {
            throw unavailable();
        }
        JsonNode data = envelope.get("data");
        if (!hasExactFields(data, MEMBERSHIP_FIELDS)
            || MEMBERSHIP_FIELDS.stream().anyMatch(field ->
                !data.get(field).isTextual())) {
            throw unavailable();
        }
        return strictMapper.treeToValue(data, CompanyMembershipPayload.class);
    }

    private static boolean hasExactFields(
        JsonNode node,
        Set<String> expected
    ) {
        if (node == null || !node.isObject() || node.size() != expected.size()) {
            return false;
        }
        return expected.stream().allMatch(node::has);
    }

    private RecruiterCompanyMembership validate(
        CompanyMembershipPayload payload
    ) {
        if (payload == null
            || !isCanonicalVersionFourUuid(payload.companyId())
            || !isValidCompanyName(payload.name())
            || payload.verifiedStatus() == null
            || payload.memberRole() == null) {
            throw unavailable();
        }
        return new RecruiterCompanyMembership(
            UUID.fromString(payload.companyId()),
            payload.memberRole()
        );
    }

    private static boolean isValidCompanyName(String name) {
        return name != null
            && name.length() >= 2
            && name.length() <= 160
            && name.equals(name.trim())
            && name.chars().noneMatch(Character::isISOControl);
    }

    private static boolean isCanonicalVersionFourUuid(String value) {
        try {
            UUID parsed = UUID.fromString(value);
            return parsed.version() == 4
                && parsed.variant() == 2
                && parsed.toString().equals(value);
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private static String authorization(String token) {
        if (token == null
            || token.isEmpty()
            || token.length() > MAX_BEARER_TOKEN_LENGTH
            || !token.equals(token.trim())
            || token.regionMatches(true, 0, "Bearer ", 0, 7)
            || token.chars().anyMatch(Character::isISOControl)
            || token.chars().anyMatch(Character::isWhitespace)) {
            throw new IllegalArgumentException("bearerToken must be a raw JWT");
        }
        return "Bearer " + token;
    }

    private static RestClient buildClient(
        String baseUrl,
        String allowedHosts,
        long timeoutMs
    ) {
        if (timeoutMs < 100 || timeoutMs > 10_000) {
            throw new IllegalStateException(
                "COMPANY_REQUEST_TIMEOUT_MS must be 100..10000"
            );
        }
        URI origin = validateBaseUrl(baseUrl, allowedHosts);
        HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(timeoutMs))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
        JdkClientHttpRequestFactory factory =
            new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        String normalized = origin.toString();
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return RestClient.builder()
            .baseUrl(normalized)
            .requestFactory(factory)
            .build();
    }

    static URI validateBaseUrl(String value, String allowedHosts) {
        URI uri;
        try {
            uri = URI.create(value == null ? "" : value);
        } catch (RuntimeException exception) {
            throw invalidBaseUrl(exception);
        }
        Set<String> hosts = Arrays.stream(
                allowedHosts == null ? new String[0] : allowedHosts.split(",")
            )
            .map(String::trim)
            .filter(host -> !host.isEmpty())
            .map(host -> host.toLowerCase(Locale.ROOT))
            .collect(Collectors.toUnmodifiableSet());
        String path = uri.getRawPath();
        String host = uri.getHost();
        if (!("http".equals(uri.getScheme())
                || "https".equals(uri.getScheme()))
            || host == null
            || !hosts.contains(host.toLowerCase(Locale.ROOT))
            || uri.getRawUserInfo() != null
            || uri.getRawQuery() != null
            || uri.getRawFragment() != null
            || !(path == null || path.isEmpty() || "/".equals(path))) {
            throw invalidBaseUrl(null);
        }
        return uri;
    }

    private static IllegalStateException invalidBaseUrl(Throwable cause) {
        String message =
            "COMPANY_SERVICE_URL must be an allowlisted HTTP(S) origin";
        return cause == null
            ? new IllegalStateException(message)
            : new IllegalStateException(message, cause);
    }

    private BusinessException denied() {
        return new BusinessException(
            "INTERVIEW_ACCESS_DENIED",
            "Recruiter cannot access this company's interviews",
            HttpStatus.FORBIDDEN
        );
    }

    private BusinessException unavailable() {
        return new BusinessException(
            "COMPANY_SERVICE_UNAVAILABLE",
            "Cannot verify recruiter company membership",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private enum CompanyVerificationStatus {
        PENDING,
        VERIFIED,
        REJECTED
    }

    private record CompanyMembershipPayload(
        String companyId,
        String name,
        CompanyVerificationStatus verifiedStatus,
        CompanyMemberRole memberRole
    ) {}
}
