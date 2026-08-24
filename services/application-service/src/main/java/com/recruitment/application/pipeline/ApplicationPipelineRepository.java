package com.recruitment.application.pipeline;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApplicationPipelineRepository
    extends JpaRepository<ApplicationEntity, UUID>,
        JpaSpecificationExecutor<ApplicationEntity> {

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
        update ApplicationEntity application
        set application.status = :status,
            application.updatedAt = :updatedAt,
            application.version = application.version + 1
        where application.id = :applicationId
          and application.version = :expectedVersion
        """)
    int transition(
        @Param("applicationId") UUID applicationId,
        @Param("status") ApplicationStatus status,
        @Param("updatedAt") Instant updatedAt,
        @Param("expectedVersion") long expectedVersion
    );
}
