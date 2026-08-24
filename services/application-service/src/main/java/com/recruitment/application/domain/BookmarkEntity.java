package com.recruitment.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "bookmarks")
public class BookmarkEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "job_id", nullable = false)
    private UUID jobId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected BookmarkEntity() {}

    public static BookmarkEntity create(
        UUID id,
        UUID userId,
        UUID jobId,
        Instant createdAt
    ) {
        BookmarkEntity bookmark = new BookmarkEntity();
        bookmark.id = id;
        bookmark.userId = userId;
        bookmark.jobId = jobId;
        bookmark.createdAt = createdAt;
        return bookmark;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public UUID getJobId() { return jobId; }
    public Instant getCreatedAt() { return createdAt; }
}
