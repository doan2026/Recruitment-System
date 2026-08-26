package com.recruitment.application.bookmark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.BulkJobDetails;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.client.JobClient.JobDetail;
import com.recruitment.application.domain.BookmarkEntity;
import com.recruitment.application.repository.BookmarkRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class BookmarkServiceTest {
    private static final Instant NOW =
        Instant.parse("2026-08-24T08:00:00Z");

    private final BookmarkRepository bookmarks =
        mock(BookmarkRepository.class);
    private final JobClient jobs = mock(JobClient.class);
    private BookmarkService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new BookmarkService(
            bookmarks,
            jobs,
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
        when(bookmarks.findByUserIdAndJobId(userId, jobId))
            .thenReturn(Optional.empty());
    }

    @Test
    void bookmarksAnActiveJob() {
        when(jobs.getAvailability(jobId)).thenReturn(activeJob());

        BookmarkResponse response = service.create(userId, jobId);

        assertThat(response.jobId()).isEqualTo(jobId);
        assertThat(response.createdAt()).isEqualTo(NOW);
        assertThat(response.job().title()).isEqualTo("Backend Engineer");
        verify(bookmarks).saveAndFlush(any(BookmarkEntity.class));
    }

    @Test
    void rejectsAJobThatIsNoLongerActive() {
        when(jobs.getAvailability(jobId)).thenReturn(
            new JobAvailability(
                jobId,
                true,
                false,
                "DEADLINE_PASSED",
                UUID.randomUUID(),
                UUID.randomUUID(),
                "Backend Engineer",
                "PUBLISHED",
                "2026-08-01"
            )
        );

        assertThatThrownBy(() -> service.create(userId, jobId))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("JOB_NOT_BOOKMARKABLE");
        verify(bookmarks, never()).saveAndFlush(any());
    }

    @Test
    void rejectsADuplicateBookmark() {
        when(jobs.getAvailability(jobId)).thenReturn(activeJob());
        when(bookmarks.findByUserIdAndJobId(userId, jobId))
            .thenReturn(Optional.of(
                BookmarkEntity.create(UUID.randomUUID(), userId, jobId, NOW)
            ));

        assertThatThrownBy(() -> service.create(userId, jobId))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("BOOKMARK_ALREADY_EXISTS");
    }

    @Test
    void loadsDetailsInBookmarkOrderWithOneBulkLookup() {
        UUID unavailableJobId = UUID.randomUUID();
        UUID expiredJobId = UUID.randomUUID();
        BookmarkEntity first = bookmark(jobId, NOW);
        BookmarkEntity unavailable = bookmark(
            unavailableJobId,
            NOW.minusSeconds(1)
        );
        BookmarkEntity expired = bookmark(
            expiredJobId,
            NOW.minusSeconds(2)
        );
        when(bookmarks.findAllByUserIdOrderByCreatedAtDesc(userId))
            .thenReturn(List.of(first, unavailable, expired));
        when(jobs.getBulkDetails(
            List.of(jobId, unavailableJobId, expiredJobId)
        )).thenReturn(new BulkJobDetails(
            List.of(
                jobDetail(jobId, "PUBLISHED", true, null),
                jobDetail(
                    expiredJobId,
                    "EXPIRED",
                    false,
                    "NOT_PUBLISHED"
                )
            ),
            List.of(unavailableJobId)
        ));

        List<BookmarkResponse> result = service.list(userId);

        assertThat(result).extracting(BookmarkResponse::jobId)
            .containsExactly(jobId, unavailableJobId, expiredJobId);
        assertThat(result.getFirst().job()).satisfies(job -> {
            assertThat(job.title()).isEqualTo("Backend Engineer");
            assertThat(job.description())
                .isEqualTo("Build recruitment services");
            assertThat(job.salaryMin()).isEqualTo("20000000.00");
            assertThat(job.skills()).containsExactly("Java", "Spring");
            assertThat(job.acceptingApplications()).isTrue();
        });
        assertThat(result.get(1).job()).isNull();
        assertThat(result.get(2).job()).satisfies(job -> {
            assertThat(job.status()).isEqualTo("EXPIRED");
            assertThat(job.acceptingApplications()).isFalse();
            assertThat(job.availabilityReason()).isEqualTo("NOT_PUBLISHED");
        });
        verify(jobs).getBulkDetails(
            List.of(jobId, unavailableJobId, expiredJobId)
        );
        verify(jobs, never()).getAvailability(any());
    }

    @Test
    void failsSoftForEveryBookmarkWhenBulkLookupFails() {
        UUID otherJobId = UUID.randomUUID();
        when(bookmarks.findAllByUserIdOrderByCreatedAtDesc(userId))
            .thenReturn(List.of(
                bookmark(jobId, NOW),
                bookmark(otherJobId, NOW.minusSeconds(1))
            ));
        when(jobs.getBulkDetails(List.of(jobId, otherJobId)))
            .thenThrow(new BusinessException(
                "JOB_SERVICE_UNAVAILABLE",
                "Cannot load bookmarked job details",
                HttpStatus.SERVICE_UNAVAILABLE
            ));

        List<BookmarkResponse> result = service.list(userId);

        assertThat(result).extracting(BookmarkResponse::jobId)
            .containsExactly(jobId, otherJobId);
        assertThat(result).extracting(BookmarkResponse::job)
            .containsOnlyNulls();
    }

    @Test
    void emptyBookmarkListDoesNotCallJobService() {
        when(bookmarks.findAllByUserIdOrderByCreatedAtDesc(userId))
            .thenReturn(List.of());

        assertThat(service.list(userId)).isEmpty();

        verify(jobs, never()).getBulkDetails(any());
        verify(jobs, never()).getAvailability(any());
    }

    @Test
    void deleteIsIdempotentAndScopedToTheCandidate() {
        service.delete(userId, jobId);

        verify(bookmarks).deleteByUserIdAndJobId(userId, jobId);
    }

    private BookmarkEntity bookmark(UUID bookmarkedJobId, Instant createdAt) {
        return BookmarkEntity.create(
            UUID.randomUUID(),
            userId,
            bookmarkedJobId,
            createdAt
        );
    }

    private JobDetail jobDetail(
        UUID detailJobId,
        String status,
        boolean acceptingApplications,
        String availabilityReason
    ) {
        return new JobDetail(
            detailJobId,
            UUID.randomUUID(),
            "Backend Engineer",
            "Build recruitment services",
            "Java and PostgreSQL",
            "Remote-friendly",
            "20000000.00",
            "30000000.00",
            false,
            "VND",
            "Ha Noi",
            "FULL_TIME",
            2,
            3,
            List.of("Java", "Spring"),
            "2099-12-31",
            status,
            NOW.minusSeconds(3600).toString(),
            NOW.minusSeconds(7200).toString(),
            NOW.toString(),
            acceptingApplications,
            availabilityReason
        );
    }
    private JobAvailability activeJob() {
        return new JobAvailability(
            jobId,
            true,
            true,
            null,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Backend Engineer",
            "PUBLISHED",
            "2099-12-31"
        );
    }
}
