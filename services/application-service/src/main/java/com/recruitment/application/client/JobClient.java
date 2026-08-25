package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
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
public class JobClient {
    private final RestClient restClient;
    private final String internalApiKey;

    public JobClient(
        RestClient.Builder builder,
        @Value("${clients.job-service-url}") String baseUrl,
        @Value("${clients.internal-api-key}") String internalApiKey
    ) {
        this.restClient = builder.baseUrl(baseUrl).build();
        this.internalApiKey = internalApiKey;
    }

    public JobAvailability getAvailability(UUID jobId) {
        try {
            ApiResponse<JobAvailability> response = restClient.get()
                .uri("/{jobId}/exists", jobId)
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            if (response == null || response.data() == null) {
                throw availabilityUnavailable();
            }
            return response.data();
        } catch (BusinessException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw availabilityUnavailable();
        }
    }

    public ActiveJobStats getActiveJobStats(UUID companyId) {
        try {
            ApiResponse<ActiveJobStats> response = restClient.get()
                .uri(uriBuilder -> uriBuilder
                    .path("/stats/active")
                    .queryParam("company_id", companyId)
                    .build())
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            ActiveJobStats stats = response == null
                ? null
                : response.data();
            if (
                stats == null ||
                !companyId.equals(stats.companyId()) ||
                stats.activeJobCount() == null ||
                stats.activeJobCount() < 0
            ) {
                throw activeStatsInvalidResponse();
            }
            return stats;
        } catch (BusinessException exception) {
            throw exception;
        } catch (
            HttpServerErrorException | ResourceAccessException exception
        ) {
            throw activeStatsUnavailable();
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                throw activeStatsUnavailable();
            }
            throw activeStatsInvalidResponse();
        } catch (RestClientException exception) {
            throw activeStatsInvalidResponse();
        }
    }

    private BusinessException availabilityUnavailable() {
        return new BusinessException(
            "JOB_SERVICE_UNAVAILABLE",
            "Cannot verify whether the job accepts applications",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private BusinessException activeStatsUnavailable() {
        return new BusinessException(
            "JOB_SERVICE_UNAVAILABLE",
            "Cannot load active job statistics",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private BusinessException activeStatsInvalidResponse() {
        return new BusinessException(
            "JOB_SERVICE_INVALID_RESPONSE",
            "Job Service returned an invalid active job statistics response",
            HttpStatus.BAD_GATEWAY
        );
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record JobAvailability(
        UUID jobId,
        boolean exists,
        boolean acceptingApplications,
        String reason,
        UUID companyId,
        UUID recruiterId,
        String jobTitle,
        String status,
        String deadline
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ActiveJobStats(UUID companyId, Long activeJobCount) {}
}
