package com.recruitment.interview.client;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.interview.api.BusinessException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class ApplicationClient {
    static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final String INTERNAL_SERVICE = "interview-service";

    private final RestClient restClient;
    private final ObjectMapper strictMapper;
    private final String internalApiKey;

    public ApplicationClient(
        ObjectMapper mapper,
        @Value("${interview.application-client.base-url}") String baseUrl,
        @Value("${interview.application-client.allowed-hosts}")
            String allowedHosts,
        @Value("${interview.application-client.request-timeout-ms}")
            long timeoutMs,
        @Value("${interview.application-client.internal-api-key}")
            String internalApiKey
    ) {
        this(
            buildClient(baseUrl, allowedHosts, timeoutMs),
            mapper,
            internalApiKey
        );
    }

    ApplicationClient(
        RestClient restClient,
        ObjectMapper mapper,
        String internalApiKey
    ) {
        validateKey(internalApiKey);
        this.restClient = restClient;
        this.strictMapper = mapper.copy().enable(
            DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES
        );
        this.internalApiKey = internalApiKey;
    }

    public ApplicationAuthorizationContext authorizeScheduling(
        UUID applicationId,
        String bearerToken
    ) {
        try {
            ApplicationAuthorizationContext context = restClient.post()
                .uri("/internal/v1/interview-scheduling/authorize")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .header("X-Internal-Service", INTERNAL_SERVICE)
                .header("X-Internal-Api-Key", internalApiKey)
                .header(HttpHeaders.AUTHORIZATION, bearerToken)
                .body(new AuthorizationRequest(applicationId))
                .exchange((request, response) -> readResponse(
                    applicationId,
                    response.getStatusCode().value(),
                    response.getHeaders().getContentType(),
                    response.getBody().readNBytes(MAX_RESPONSE_BYTES + 1)
                ));
            validateContext(applicationId, context);
            return context;
        } catch (BusinessException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw unavailable();
        }
    }

    private ApplicationAuthorizationContext readResponse(
        UUID expectedApplicationId,
        int status,
        MediaType contentType,
        byte[] payload
    ) throws IOException {
        if (payload.length > MAX_RESPONSE_BYTES) throw unavailable();
        if (status == 403) throw denied();
        if (status == 404) throw notFound();
        if (status == 409) throw notSchedulable();
        if (status < 200 || status >= 300) throw unavailable();
        if (
            contentType == null ||
            !MediaType.APPLICATION_JSON.isCompatibleWith(contentType)
        ) {
            throw unavailable();
        }

        JavaType type = strictMapper.getTypeFactory().constructParametricType(
            Envelope.class,
            ApplicationAuthorizationContext.class
        );
        Envelope<ApplicationAuthorizationContext> envelope =
            strictMapper.readValue(payload, type);
        if (envelope == null || envelope.meta() != null) throw unavailable();
        validateContext(expectedApplicationId, envelope.data());
        return envelope.data();
    }

    private void validateContext(
        UUID expectedApplicationId,
        ApplicationAuthorizationContext context
    ) {
        if (
            context == null ||
            !expectedApplicationId.equals(context.applicationId()) ||
            context.jobId() == null ||
            context.companyId() == null ||
            context.candidateId() == null ||
            context.applicationVersion() < 0 ||
            !("REVIEWING".equals(context.status()) ||
                "INTERVIEW".equals(context.status()))
        ) {
            throw unavailable();
        }
    }

    private static RestClient buildClient(
        String baseUrl,
        String allowedHosts,
        long timeoutMs
    ) {
        if (timeoutMs < 100 || timeoutMs > 10_000) {
            throw new IllegalStateException(
                "APPLICATION_REQUEST_TIMEOUT_MS must be 100..10000"
            );
        }
        URI uri = validateBaseUrl(baseUrl, allowedHosts);
        HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(timeoutMs))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
        JdkClientHttpRequestFactory factory =
            new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        String normalized = uri.toString();
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
            throw new IllegalStateException(
                "APPLICATION_SERVICE_URL is invalid",
                exception
            );
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
        if (
            !("http".equals(uri.getScheme()) ||
                "https".equals(uri.getScheme())) ||
            host == null ||
            !hosts.contains(host.toLowerCase(Locale.ROOT)) ||
            uri.getRawUserInfo() != null ||
            uri.getRawQuery() != null ||
            uri.getRawFragment() != null ||
            !(path == null || path.isEmpty() || "/".equals(path))
        ) {
            throw new IllegalStateException(
                "APPLICATION_SERVICE_URL must be an allowlisted HTTP(S) origin"
            );
        }
        return uri;
    }

    private static void validateKey(String key) {
        byte[] bytes = key == null
            ? new byte[0]
            : key.getBytes(StandardCharsets.UTF_8);
        if (
            bytes.length < 32 ||
            !key.equals(key.trim()) ||
            key.toLowerCase(Locale.ROOT).contains("replace-with") ||
            key.chars().anyMatch(Character::isISOControl)
        ) {
            throw new IllegalStateException(
                "APPLICATION_INTERNAL_API_KEY must be a non-placeholder key " +
                "of at least 32 bytes"
            );
        }
    }

    private BusinessException denied() {
        return new BusinessException(
            "APPLICATION_ACCESS_DENIED",
            "Recruiter cannot schedule this application",
            HttpStatus.FORBIDDEN
        );
    }

    private BusinessException notFound() {
        return new BusinessException(
            "APPLICATION_NOT_FOUND",
            "Application was not found",
            HttpStatus.NOT_FOUND
        );
    }

    private BusinessException notSchedulable() {
        return new BusinessException(
            "APPLICATION_NOT_SCHEDULABLE",
            "Application is not ready for interview scheduling",
            HttpStatus.CONFLICT
        );
    }

    private BusinessException unavailable() {
        return new BusinessException(
            "APPLICATION_SERVICE_UNAVAILABLE",
            "Cannot verify application scheduling permission",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private record AuthorizationRequest(UUID applicationId) {}
    private record Envelope<T>(T data, Map<String, Object> meta) {}
}
