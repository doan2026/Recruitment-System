package com.recruitment.application.repository;

import com.recruitment.application.domain.BookmarkEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BookmarkRepository
    extends JpaRepository<BookmarkEntity, UUID> {

    Optional<BookmarkEntity> findByUserIdAndJobId(UUID userId, UUID jobId);

    List<BookmarkEntity> findAllByUserIdOrderByCreatedAtDesc(UUID userId);

    long deleteByUserIdAndJobId(UUID userId, UUID jobId);
}
