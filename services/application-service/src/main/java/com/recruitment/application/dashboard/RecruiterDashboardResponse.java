package com.recruitment.application.dashboard;

import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record RecruiterDashboardResponse(
    UUID companyId,
    Instant generatedAt,
    DashboardRange range,
    DashboardSummary summary,
    Map<ApplicationStatus, Long> statusCounts,
    List<JobApplications> applicationsByJob,
    List<FunnelStage> funnel,
    List<TimeSeriesPoint> timeSeries,
    Map<ApplicationSource, Long> sourceBreakdown,
    List<DashboardWarning> warnings
) {
    public record DashboardRange(
        Instant from,
        Instant toExclusive,
        DashboardGranularity granularity,
        String timezone
    ) {}

    public record DashboardSummary(
        ActiveJobs activeJobs,
        long totalApplications,
        long hiredApplications,
        BigDecimal hiredRatePercent
    ) {}

    public record ActiveJobs(Long count, boolean available) {}

    public record JobApplications(
        UUID jobId,
        String jobTitle,
        long totalApplications,
        Map<ApplicationStatus, Long> statusCounts
    ) {}

    public record FunnelStage(
        ApplicationStatus status,
        long count,
        BigDecimal rateFromPreviousPercent
    ) {}

    public record TimeSeriesPoint(LocalDate bucketStart, long count) {}

    public record DashboardWarning(String code, String message) {}
}
