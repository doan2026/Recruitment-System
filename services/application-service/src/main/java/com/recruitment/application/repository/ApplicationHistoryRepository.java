package com.recruitment.application.repository;

import com.recruitment.application.domain.ApplicationHistoryEntity;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApplicationHistoryRepository
    extends JpaRepository<ApplicationHistoryEntity, UUID> {}
