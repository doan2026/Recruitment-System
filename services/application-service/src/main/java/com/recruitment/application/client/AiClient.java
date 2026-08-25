package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class AiClient {
    private static final BigDecimal MIN_SCORE = BigDecimal.ZERO;
    private static final BigDecimal MAX_SCORE = BigDecimal.ONE;

    private final RestClient restClient;
    private final String internalApiKey;

    public AiClient(
        RestClient.Builder builder,
        @Value("${clients.ai-service-url}") String baseUrl,
        @Value("${clients.internal-api-key}") String internalApiKey
    ) {
        this.restClient = builder.baseUrl(baseUrl).build();
        this.internalApiKey = internalApiKey;
    }

    public BigDecimal getMatchScore(UUID cvId, UUID jobId) {
        try {
            ApiResponse<AiMatchResponse> response = restClient.post()
                .uri("/match")
                .header("X-Internal-Api-Key", internalApiKey)
                .body(new AiMatchRequest(cvId, jobId))
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            AiMatchResponse match = response == null ? null : response.data();
            validateIdentity(match, cvId, jobId);

            if (match.score() == null) {
                String reason = normalizeReason(match.reason());
                if (reason == null) {
                    throw invalidResponse();
                }
                throw notReady(reason);
            }
            if (
                match.score().compareTo(MIN_SCORE) < 0 ||
                match.score().compareTo(MAX_SCORE) > 0 ||
                normalizeReason(match.reason()) != null
            ) {
                throw invalidResponse();
            }
            return match.score()
                .movePointRight(2)
                .setScale(2, RoundingMode.HALF_UP);
        } catch (BusinessException exception) {
            throw exception;
        } catch (
            HttpServerErrorException | ResourceAccessException exception
        ) {
            throw unavailable();
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                throw unavailable();
            }
            throw invalidResponse();
        } catch (RestClientException exception) {
            throw invalidResponse();
        }
    }

    private void validateIdentity(
        AiMatchResponse match,
        UUID expectedCvId,
        UUID expectedJobId
    ) {
        if (
            match == null ||
            !expectedCvId.equals(match.cvId()) ||
            !expectedJobId.equals(match.jobId())
        ) {
            throw invalidResponse();
        }
    }

    private String normalizeReason(String reason) {
        if (reason == null) {
            return null;
        }
        String normalized = reason.strip();
        return normalized.isEmpty() ? null : normalized;
    }

    private BusinessException notReady(String reason) {
        return new BusinessException(
            "AI_MATCH_NOT_READY",
            "AI match score is not ready for this CV and job",
            HttpStatus.CONFLICT,
            Map.of("reason", reason)
        );
    }

    private BusinessException unavailable() {
        return new BusinessException(
            "AI_SERVICE_UNAVAILABLE",
            "Cannot calculate the application match score",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private BusinessException invalidResponse() {
        return new BusinessException(
            "AI_SERVICE_INVALID_RESPONSE",
            "AI Service returned an invalid match response",
            HttpStatus.BAD_GATEWAY
        );
    }

    private record AiMatchRequest(
        @JsonProperty("cv_id") UUID cvId,
        @JsonProperty("job_id") UUID jobId
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record AiMatchResponse(
        @JsonAlias("cv_id") UUID cvId,
        @JsonAlias("job_id") UUID jobId,
        BigDecimal score,
        String reason
    ) {}
}
