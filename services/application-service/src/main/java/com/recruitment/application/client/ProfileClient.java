package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.recruitment.application.api.BusinessException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class ProfileClient {
    private static final String CALLER_SERVICE = "application-service";
    private static final Set<String> CV_TYPES = Set.of("UPLOAD", "ONLINE");
    private static final Duration MAX_DOWNLOAD_TTL = Duration.ofMinutes(10);

    private final RestClient restClient;
    private final String internalApiKey;

    public ProfileClient(
        RestClient.Builder builder,
        @Value("${clients.profile-service-url}") String baseUrl,
        @Value("${clients.profile-internal-api-key}") String internalApiKey
    ) {
        this.restClient = builder.baseUrl(baseUrl).build();
        this.internalApiKey = validateInternalKey(internalApiKey);
    }

    public boolean candidateOwnsCv(
        UUID candidateId,
        UUID cvId,
        String authorization
    ) {
        if (!isUuidV4(candidateId)) {
            throw invalidTokenSubject();
        }
        if (!isUuidV4(cvId)) {
            return false;
        }

        try {
            Envelope<CvVerification> response = restClient.post()
                .uri("/internal/v1/cvs/verify")
                .headers(headers -> internalHeaders(headers, authorization))
                .contentType(MediaType.APPLICATION_JSON)
                .body(new CvVerificationRequest(candidateId, cvId))
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            CvVerification verification = requireEnvelope(response);
            if (
                !candidateId.equals(verification.candidateId()) ||
                !cvId.equals(verification.cvId()) ||
                verification.available() == null
            ) {
                throw invalidResponse();
            }
            if (!verification.available()) {
                if (verification.cv() != null) {
                    throw invalidResponse();
                }
                return false;
            }
            validateCv(verification.cv(), candidateId, cvId, false);
            return true;
        } catch (BusinessException exception) {
            throw exception;
        } catch (
            HttpServerErrorException |
            ResourceAccessException exception
        ) {
            throw unavailable();
        } catch (HttpClientErrorException exception) {
            throw clientError(exception);
        } catch (RestClientException exception) {
            throw invalidResponse();
        }
    }

    public ProfileCv getCandidateCv(UUID candidateId, UUID cvId) {
        try {
            Envelope<ProfileCv> response = restClient.get()
                .uri(
                    "/internal/v1/candidates/{candidateId}/cvs/{cvId}",
                    candidateId,
                    cvId
                )
                .headers(headers -> internalHeaders(headers, null))
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            ProfileCv cv = requireEnvelope(response);
            validateCv(cv, candidateId, cvId, true);
            return cv;
        } catch (BusinessException exception) {
            throw exception;
        } catch (
            HttpServerErrorException |
            ResourceAccessException exception
        ) {
            throw unavailable();
        } catch (HttpClientErrorException exception) {
            throw clientError(exception);
        } catch (RestClientException exception) {
            throw invalidResponse();
        }
    }

    public CvDownloadUrl createCandidateCvDownloadUrl(
        UUID candidateId,
        UUID cvId
    ) {
        try {
            Envelope<CvDownloadUrl> response = restClient.post()
                .uri(
                    "/internal/v1/candidates/{candidateId}/cvs/{cvId}/download-url",
                    candidateId,
                    cvId
                )
                .headers(headers -> internalHeaders(headers, null))
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            CvDownloadUrl download = requireEnvelope(response);
            validateDownload(download, candidateId, cvId);
            return download;
        } catch (BusinessException exception) {
            throw exception;
        } catch (
            HttpServerErrorException |
            ResourceAccessException exception
        ) {
            throw unavailable();
        } catch (HttpClientErrorException exception) {
            throw clientError(exception);
        } catch (RestClientException exception) {
            throw invalidResponse();
        }
    }

    private void internalHeaders(
        HttpHeaders headers,
        String authorization
    ) {
        headers.set("X-Internal-Service", CALLER_SERVICE);
        headers.set("X-Internal-Api-Key", internalApiKey);
        if (authorization != null) {
            headers.set(HttpHeaders.AUTHORIZATION, authorization);
        }
    }

    private <T> T requireEnvelope(Envelope<T> response) {
        if (
            response == null ||
            response.data() == null ||
            response.meta() != null
        ) {
            throw invalidResponse();
        }
        return response.data();
    }

    private void validateCv(
        ProfileCv cv,
        UUID candidateId,
        UUID cvId,
        boolean allowDeleted
    ) {
        if (
            cv == null ||
            !cvId.equals(cv.cvId()) ||
            !isUuidV4(cv.cvId()) ||
            !isUuidV4(cv.candidateId()) ||
            !candidateId.equals(cv.candidateId()) ||
            isBlank(cv.title()) ||
            cv.title().length() > 160 ||
            !cv.title().equals(cv.title().strip()) ||
            !CV_TYPES.contains(cv.type()) ||
            !isUuidV4(cv.fileId()) ||
            cv.isDefault() == null ||
            cv.isDeleted() == null ||
            (!allowDeleted && cv.isDeleted()) ||
            cv.aggregateVersion() == null ||
            (
                Boolean.TRUE.equals(cv.isDeleted()) &&
                Boolean.TRUE.equals(cv.isDefault())
            ) ||
            cv.aggregateVersion() < 1 ||
            cv.createdAt() == null ||
            cv.updatedAt() == null ||
            cv.updatedAt().isBefore(cv.createdAt()) ||
            (
                cv.firstUsedAt() != null &&
                cv.firstUsedAt().isBefore(cv.createdAt())
            )
        ) {
            throw invalidResponse();
        }
    }

    private void validateDownload(
        CvDownloadUrl download,
        UUID candidateId,
        UUID cvId
    ) {
        Instant now = Instant.now();
        if (
            download == null ||
            !candidateId.equals(download.candidateId()) ||
            !cvId.equals(download.cvId()) ||
            !isHttps(download.url()) ||
            download.expiresAt() == null ||
            !download.expiresAt().isAfter(now) ||
            download.expiresAt().isAfter(now.plus(MAX_DOWNLOAD_TTL))
        ) {
            throw invalidResponse();
        }
    }

    private boolean isHttps(String value) {
        if (isBlank(value)) return false;
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) &&
                uri.isAbsolute() &&
                uri.getHost() != null &&
                uri.getUserInfo() == null &&
                uri.getFragment() == null;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private boolean isUuidV4(UUID value) {
        return value != null && value.version() == 4 && value.variant() == 2;
    }

    private BusinessException invalidTokenSubject() {
        return new BusinessException(
            "INVALID_TOKEN_SUBJECT",
            "JWT subject must be a UUIDv4",
            HttpStatus.UNAUTHORIZED
        );
    }

    private String validateInternalKey(String configuredKey) {
        String key = configuredKey == null ? "" : configuredKey;
        if (
            key.getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32 ||
            !key.equals(key.trim()) ||
            key.toLowerCase(Locale.ROOT).contains("replace-with") ||
            key.chars().anyMatch(character -> Character.isISOControl(character))
        ) {
            throw new IllegalStateException(
                "PROFILE_INTERNAL_API_KEY must be a non-placeholder key " +
                "of at least 32 bytes"
            );
        }
        return key;
    }

    private BusinessException clientError(
        HttpClientErrorException exception
    ) {
        int status = exception.getStatusCode().value();
        if (status == 401 || status == 403 || status == 429) {
            return unavailable();
        }
        return invalidResponse();
    }

    private BusinessException unavailable() {
        return new BusinessException(
            "PROFILE_SERVICE_UNAVAILABLE",
            "Cannot verify or load the selected CV",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private BusinessException invalidResponse() {
        return new BusinessException(
            "PROFILE_SERVICE_INVALID_RESPONSE",
            "Profile Service returned an invalid CV response",
            HttpStatus.BAD_GATEWAY
        );
    }

    private record CvVerificationRequest(UUID candidateId, UUID cvId) {}

    @JsonIgnoreProperties(ignoreUnknown = false)
    private record Envelope<T>(T data, Map<String, Object> meta) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                "Unknown Profile envelope field: " + field
            );
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    private record CvVerification(
        UUID candidateId,
        UUID cvId,
        Boolean available,
        ProfileCv cv
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                "Unknown CV verification field: " + field
            );
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record ProfileCv(
        UUID cvId,
        UUID candidateId,
        String title,
        String type,
        UUID fileId,
        Boolean isDefault,
        Boolean isDeleted,
        Instant firstUsedAt,
        Long aggregateVersion,
        Instant createdAt,
        Instant updatedAt
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                "Unknown Profile CV field: " + field
            );
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record CvDownloadUrl(
        UUID candidateId,
        UUID cvId,
        String url,
        Instant expiresAt
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                "Unknown CV download field: " + field
            );
        }
    }
}
