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
import com.recruitment.application.client.JobClient.JobAvailability;
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
    void keepsExpiredJobsInTheBookmarkList() {
        BookmarkEntity bookmark = BookmarkEntity.create(
            UUID.randomUUID(),
            userId,
            jobId,
            NOW
        );
        JobAvailability expired = new JobAvailability(
            jobId,
            true,
            false,
            "DEADLINE_PASSED",
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Backend Engineer",
            "EXPIRED",
            "2026-08-01"
        );
        when(bookmarks.findAllByUserIdOrderByCreatedAtDesc(userId))
            .thenReturn(List.of(bookmark));
        when(jobs.getAvailability(jobId)).thenReturn(expired);

        List<BookmarkResponse> result = service.list(userId);

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().job().status()).isEqualTo("EXPIRED");
        assertThat(result.getFirst().job().acceptingApplications()).isFalse();
    }

    @Test
    void deleteIsIdempotentAndScopedToTheCandidate() {
        service.delete(userId, jobId);

        verify(bookmarks).deleteByUserIdAndJobId(userId, jobId);
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
