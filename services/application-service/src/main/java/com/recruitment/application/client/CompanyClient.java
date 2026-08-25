package com.recruitment.application.client;

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

    public RecruiterCompanyMembership getRecruiterMembership(
        UUID recruiterId,
        String authorization
    ) {
        try {
            ApiResponse<RecruiterCompanyMembership> response = restClient.get()
                .uri("/by-user/{userId}", recruiterId)
                .header(HttpHeaders.AUTHORIZATION, authorization)
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            if (
                response == null ||
                response.data() == null ||
                response.data().companyId() == null ||
                !response.data().canManageAllCompanyApplications()
            ) {
                throw unavailable();
            }
            return response.data();
        } catch (HttpClientErrorException exception) {
            if (
                exception.getStatusCode() == HttpStatus.FORBIDDEN ||
                exception.getStatusCode() == HttpStatus.NOT_FOUND
            ) {
                throw denied();
            }
            throw unavailable();
        } catch (BusinessException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw unavailable();
        }
    }

    private BusinessException denied() {
        return new BusinessException(
            "APPLICATION_ACCESS_DENIED",
            "Recruiter does not belong to the application's company",
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
}
