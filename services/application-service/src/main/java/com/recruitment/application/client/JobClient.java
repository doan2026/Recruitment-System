package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.recruitment.application.api.ApiResponse;
import com.recruitment.application.api.BusinessException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class JobClient {
    private static final int MAX_BULK_JOB_IDS = 100;
    private static final Set<String> EXPOSED_JOB_STATUSES = Set.of(
        "PUBLISHED",
        "CLOSED",
        "EXPIRED"
    );
    private static final Set<String> JOB_TYPES = Set.of(
        "FULL_TIME",
        "PART_TIME",
        "INTERNSHIP",
        "REMOTE"
    );

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

    public BulkJobDetails getBulkDetails(List<UUID> jobIds) {
        if (jobIds == null || jobIds.isEmpty()) {
            return new BulkJobDetails(List.of(), List.of());
        }
        if (jobIds.stream().anyMatch(jobId -> jobId == null)) {
            throw bulkDetailsInvalidResponse();
        }
        List<UUID> requestedJobIds = List.copyOf(new LinkedHashSet<>(jobIds));

        List<JobDetail> items = new ArrayList<>();
        List<UUID> unavailableJobIds = new ArrayList<>();
        for (
            int start = 0;
            start < requestedJobIds.size();
            start += MAX_BULK_JOB_IDS
        ) {
            int end = Math.min(
                start + MAX_BULK_JOB_IDS,
                requestedJobIds.size()
            );
            List<UUID> chunk = requestedJobIds.subList(start, end);
            BulkJobDetails response = loadBulkDetailsChunk(chunk);
            items.addAll(response.items());
            unavailableJobIds.addAll(response.unavailableJobIds());
        }
        return new BulkJobDetails(
            List.copyOf(items),
            List.copyOf(unavailableJobIds)
        );
    }

    private BulkJobDetails loadBulkDetailsChunk(List<UUID> jobIds) {
        try {
            ApiResponse<BulkJobDetails> response = restClient.post()
                .uri("/details/bulk")
                .header("X-Internal-Api-Key", internalApiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(new BulkJobDetailRequest(jobIds))
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
            BulkJobDetails details = response == null
                ? null
                : response.data();
            validateBulkDetails(jobIds, details);
            return details;
        } catch (BusinessException exception) {
            throw exception;
        } catch (
            HttpServerErrorException | ResourceAccessException exception
        ) {
            throw bulkDetailsUnavailable();
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                throw bulkDetailsUnavailable();
            }
            throw bulkDetailsInvalidResponse();
        } catch (RestClientException exception) {
            throw bulkDetailsInvalidResponse();
        }
    }

    private void validateBulkDetails(
        List<UUID> requestedJobIds,
        BulkJobDetails details
    ) {
        if (
            details == null ||
            details.items() == null ||
            details.unavailableJobIds() == null
        ) {
            throw bulkDetailsInvalidResponse();
        }

        Set<UUID> requested = Set.copyOf(requestedJobIds);
        Set<UUID> covered = new LinkedHashSet<>();
        List<UUID> returnedItemIds = new ArrayList<>();
        for (JobDetail item : details.items()) {
            if (
                !isValidJobDetail(item) ||
                !requested.contains(item.id()) ||
                !covered.add(item.id())
            ) {
                throw bulkDetailsInvalidResponse();
            }
            returnedItemIds.add(item.id());
        }
        Set<UUID> unavailable = new LinkedHashSet<>();
        for (UUID unavailableJobId : details.unavailableJobIds()) {
            if (
                unavailableJobId == null ||
                !requested.contains(unavailableJobId) ||
                !unavailable.add(unavailableJobId) ||
                !covered.add(unavailableJobId)
            ) {
                throw bulkDetailsInvalidResponse();
            }
        }
        if (!covered.equals(requested)) {
            throw bulkDetailsInvalidResponse();
        }

        List<UUID> expectedItemOrder = requestedJobIds.stream()
            .filter(jobId -> !unavailable.contains(jobId))
            .toList();
        if (!returnedItemIds.equals(expectedItemOrder)) {
            throw bulkDetailsInvalidResponse();
        }
    }

    private boolean isValidJobDetail(JobDetail item) {
        if (
            item == null ||
            item.id() == null ||
            item.companyId() == null ||
            !hasLength(item.title(), 2, 200) ||
            !hasLength(item.description(), 1, 20_000) ||
            !hasLength(item.requirements(), 1, 20_000) ||
            !hasLength(item.benefits(), 1, 20_000) ||
            item.isNegotiable() == null ||
            item.currency() == null ||
            !item.currency().matches("[A-Z]{3}") ||
            !hasLength(item.location(), 1, 255) ||
            !JOB_TYPES.contains(item.jobType()) ||
            item.experienceYears() == null ||
            item.experienceYears() < 0 ||
            item.experienceYears() > 60 ||
            item.quantity() == null ||
            item.quantity() < 1 ||
            item.quantity() > 10_000 ||
            item.skills() == null ||
            item.skills().isEmpty() ||
            item.skills().size() > 50 ||
            item.skills().stream().anyMatch(this::isBlank) ||
            isBlank(item.deadline()) ||
            !EXPOSED_JOB_STATUSES.contains(item.status()) ||
            isBlank(item.createdAt()) ||
            isBlank(item.updatedAt()) ||
            item.acceptingApplications() == null ||
            !hasValidSalary(item) ||
            !hasValidAvailability(item)
        ) {
            return false;
        }
        try {
            LocalDate.parse(item.deadline());
            Instant createdAt = Instant.parse(item.createdAt());
            Instant updatedAt = Instant.parse(item.updatedAt());
            if (updatedAt.isBefore(createdAt)) {
                return false;
            }
            if (item.publishedAt() != null) {
                Instant.parse(item.publishedAt());
            }
            return true;
        } catch (DateTimeParseException exception) {
            return false;
        }
    }

    private boolean hasValidSalary(JobDetail item) {
        if (item.isNegotiable()) {
            return item.salaryMin() == null && item.salaryMax() == null;
        }
        if (item.salaryMin() == null || item.salaryMax() == null) {
            return false;
        }
        try {
            java.math.BigDecimal salaryMin =
                new java.math.BigDecimal(item.salaryMin());
            java.math.BigDecimal salaryMax =
                new java.math.BigDecimal(item.salaryMax());
            return salaryMin.signum() >= 0 &&
                salaryMax.signum() >= 0 &&
                salaryMin.compareTo(salaryMax) <= 0;
        } catch (NumberFormatException exception) {
            return false;
        }
    }

    private boolean hasValidAvailability(JobDetail item) {
        if (item.acceptingApplications()) {
            return "PUBLISHED".equals(item.status()) &&
                item.availabilityReason() == null;
        }
        if ("PUBLISHED".equals(item.status())) {
            return "DEADLINE_PASSED".equals(item.availabilityReason());
        }
        return (
            "CLOSED".equals(item.status()) ||
            "EXPIRED".equals(item.status())
        ) && "NOT_PUBLISHED".equals(item.availabilityReason());
    }

    private boolean hasLength(String value, int minimum, int maximum) {
        return !isBlank(value) &&
            value.length() >= minimum &&
            value.length() <= maximum;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
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

    private BusinessException bulkDetailsUnavailable() {
        return new BusinessException(
            "JOB_SERVICE_UNAVAILABLE",
            "Cannot load bookmarked job details",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private BusinessException bulkDetailsInvalidResponse() {
        return new BusinessException(
            "JOB_SERVICE_INVALID_RESPONSE",
            "Job Service returned an invalid bulk job details response",
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

    private record BulkJobDetailRequest(List<UUID> jobIds) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BulkJobDetails(
        List<JobDetail> items,
        List<UUID> unavailableJobIds
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record JobDetail(
        UUID id,
        UUID companyId,
        String title,
        String description,
        String requirements,
        String benefits,
        String salaryMin,
        String salaryMax,
        Boolean isNegotiable,
        String currency,
        String location,
        String jobType,
        Integer experienceYears,
        Integer quantity,
        List<String> skills,
        String deadline,
        String status,
        String publishedAt,
        String createdAt,
        String updatedAt,
        Boolean acceptingApplications,
        String availabilityReason
    ) {}
}
