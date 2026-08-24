package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
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
                throw unavailable();
            }
            return response.data();
        } catch (BusinessException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw unavailable();
        }
    }

    private BusinessException unavailable() {
        return new BusinessException(
            "JOB_SERVICE_UNAVAILABLE",
            "Cannot verify whether the job accepts applications",
            HttpStatus.SERVICE_UNAVAILABLE
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
}
