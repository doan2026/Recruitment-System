package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class CompanyClient {
    private final RestClient restClient;

    public CompanyClient(
        RestClient.Builder builder,
        @Value("${COMPANY_SERVICE_URL:http://company-service:3000}")
        String baseUrl
    ) {
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    public UUID getRecruiterCompanyId(
        UUID recruiterId,
        String authorization
    ) {
        try {
            ApiResponse<RecruiterCompany> response = restClient.get()
                .uri("/by-user/{userId}", recruiterId)
                .header(HttpHeaders.AUTHORIZATION, authorization)
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            if (response == null || response.data() == null) {
                throw unavailable();
            }
            return response.data().companyId();
        } catch (HttpClientErrorException exception) {
            throw new BusinessException(
                "APPLICATION_ACCESS_DENIED",
                "Recruiter does not belong to the application's company",
                HttpStatus.FORBIDDEN
            );
        } catch (BusinessException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw unavailable();
        }
    }

    private BusinessException unavailable() {
        return new BusinessException(
            "COMPANY_SERVICE_UNAVAILABLE",
            "Cannot verify recruiter company membership",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RecruiterCompany(UUID companyId) {}
}
