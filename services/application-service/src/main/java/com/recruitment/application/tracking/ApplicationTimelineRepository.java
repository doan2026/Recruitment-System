package com.recruitment.application.tracking;

import com.recruitment.application.domain.ApplicationHistoryEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApplicationTimelineRepository
    extends JpaRepository<ApplicationHistoryEntity, UUID> {

    @Query("""
        select new com.recruitment.application.tracking.TimelineEntryResponse(
            history.fromStatus,
            history.toStatus,
            history.note,
            history.changedAt
        )
        from ApplicationHistoryEntity history
        where history.applicationId = :applicationId
        order by history.changedAt asc
        """)
    List<TimelineEntryResponse> findTimeline(
        @Param("applicationId") UUID applicationId
    );
}
