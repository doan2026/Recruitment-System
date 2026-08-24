package com.recruitment.application.bookmark;

import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.domain.BookmarkEntity;
import java.time.Instant;
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

    public record JobSummary(
        boolean exists,
        UUID companyId,
        String title,
        String status,
        String deadline,
        boolean acceptingApplications
    ) {
        static JobSummary from(JobAvailability job) {
            return new JobSummary(
                job.exists(),
                job.companyId(),
                job.jobTitle(),
                job.status(),
                job.deadline(),
                job.acceptingApplications()
            );
        }
    }
}
