package com.recruitment.application.bookmark;

import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.client.JobClient.JobDetail;
import com.recruitment.application.domain.BookmarkEntity;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record BookmarkResponse(
    UUID id,
    UUID jobId,
    Instant createdAt,
    JobSummary job
) {
    static BookmarkResponse from(
        BookmarkEntity bookmark,
        JobAvailability availability
    ) {
        return new BookmarkResponse(
            bookmark.getId(),
            bookmark.getJobId(),
            bookmark.getCreatedAt(),
            availability == null ? null : JobSummary.from(availability)
        );
    }

    static BookmarkResponse fromDetail(
        BookmarkEntity bookmark,
        JobDetail detail
    ) {
        return new BookmarkResponse(
            bookmark.getId(),
            bookmark.getJobId(),
            bookmark.getCreatedAt(),
            detail == null ? null : JobSummary.from(detail)
        );
    }

    public record JobSummary(
        boolean exists,
        UUID companyId,
        String title,
        String status,
        String deadline,
        boolean acceptingApplications,
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
        String publishedAt,
        String createdAt,
        String updatedAt,
        String availabilityReason
    ) {
        static JobSummary from(JobAvailability job) {
            return new JobSummary(
                job.exists(),
                job.companyId(),
                job.jobTitle(),
                job.status(),
                job.deadline(),
                job.acceptingApplications(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                job.reason()
            );
        }

        static JobSummary from(JobDetail job) {
            return new JobSummary(
                true,
                job.companyId(),
                job.title(),
                job.status(),
                job.deadline(),
                job.acceptingApplications(),
                job.description(),
                job.requirements(),
                job.benefits(),
                job.salaryMin(),
                job.salaryMax(),
                job.isNegotiable(),
                job.currency(),
                job.location(),
                job.jobType(),
                job.experienceYears(),
                job.quantity(),
                List.copyOf(job.skills()),
                job.publishedAt(),
                job.createdAt(),
                job.updatedAt(),
                job.availabilityReason()
            );
        }
    }
}
