package com.recruitment.application.bookmark;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.domain.BookmarkEntity;
import com.recruitment.application.repository.BookmarkRepository;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BookmarkService {
    private final BookmarkRepository bookmarks;
    private final JobClient jobs;
    private final Clock clock;

    public BookmarkService(BookmarkRepository bookmarks, JobClient jobs) {
        this(bookmarks, jobs, Clock.systemUTC());
    }

    BookmarkService(
        BookmarkRepository bookmarks,
        JobClient jobs,
        Clock clock
    ) {
        this.bookmarks = bookmarks;
        this.jobs = jobs;
        this.clock = clock;
    }

    @Transactional
    public BookmarkResponse create(UUID userId, UUID jobId) {
        JobAvailability job = jobs.getAvailability(jobId);
        if (!job.exists()) {
            throw new BusinessException(
                "JOB_NOT_FOUND",
                "Job was not found",
                HttpStatus.NOT_FOUND
            );
        }
        if (!job.acceptingApplications()) {
            throw new BusinessException(
                "JOB_NOT_BOOKMARKABLE",
                "Only an active published job can be bookmarked",
                HttpStatus.CONFLICT
            );
        }
        if (bookmarks.findByUserIdAndJobId(userId, jobId).isPresent()) {
            throw duplicate();
        }

        BookmarkEntity bookmark = BookmarkEntity.create(
            UUID.randomUUID(),
            userId,
            jobId,
            clock.instant()
        );
        try {
            bookmarks.saveAndFlush(bookmark);
        } catch (DataIntegrityViolationException exception) {
            throw duplicate();
        }
        return BookmarkResponse.from(bookmark, job);
    }

    @Transactional(readOnly = true)
    public List<BookmarkResponse> list(UUID userId) {
        return bookmarks.findAllByUserIdOrderByCreatedAtDesc(userId)
            .stream()
            .map(bookmark -> BookmarkResponse.from(
                bookmark,
                getAvailabilityOrNull(bookmark.getJobId())
            ))
            .toList();
    }

    @Transactional
    public void delete(UUID userId, UUID jobId) {
        bookmarks.deleteByUserIdAndJobId(userId, jobId);
    }

    private JobAvailability getAvailabilityOrNull(UUID jobId) {
        try {
            return jobs.getAvailability(jobId);
        } catch (BusinessException exception) {
            return null;
        }
    }

    private BusinessException duplicate() {
        return new BusinessException(
            "BOOKMARK_ALREADY_EXISTS",
            "This job is already bookmarked",
            HttpStatus.CONFLICT
        );
    }
}
