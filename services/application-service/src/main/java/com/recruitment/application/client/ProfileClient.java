package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class ProfileClient {
    private final RestClient restClient;

    public ProfileClient(
        RestClient.Builder builder,
        @Value("${clients.profile-service-url}") String baseUrl
    ) {
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    public boolean candidateOwnsCv(
        UUID candidateId,
        UUID cvId,
        String authorization
    ) {
        try {
            ApiResponse<List<CvSummary>> response = restClient.get()
                .uri(uri -> uri
                    .path("/cv")
                    .queryParam("user_id", candidateId)
                    .build())
                .header(HttpHeaders.AUTHORIZATION, authorization)
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            if (response == null || response.data() == null) {
                throw unavailable();
            }
            return response.data().stream()
                .anyMatch(cv -> cvId.equals(cv.id()) && !cv.deleted());
        } catch (BusinessException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw unavailable();
        }
    }

    private BusinessException unavailable() {
        return new BusinessException(
            "PROFILE_SERVICE_UNAVAILABLE",
            "Cannot verify the selected CV",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CvSummary(
        @JsonAlias({"cv_id", "id"}) UUID id,
        @JsonAlias("is_deleted") Boolean isDeleted
    ) {
        boolean deleted() {
            return Boolean.TRUE.equals(isDeleted);
        }
    }
}
