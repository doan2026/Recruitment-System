package com.recruitment.application.dashboard;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.ActiveJobStats;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.dashboard.RecruiterDashboardRepository.DashboardSnapshot;
import com.recruitment.application.dashboard.RecruiterDashboardResponse.ActiveJobs;
import com.recruitment.application.dashboard.RecruiterDashboardResponse.DashboardRange;
import com.recruitment.application.dashboard.RecruiterDashboardResponse.DashboardSummary;
import com.recruitment.application.dashboard.RecruiterDashboardResponse.DashboardWarning;
import com.recruitment.application.dashboard.RecruiterDashboardResponse.FunnelStage;
import com.recruitment.application.dashboard.RecruiterDashboardResponse.JobApplications;
import com.recruitment.application.dashboard.RecruiterDashboardResponse.TimeSeriesPoint;
import com.recruitment.application.domain.ApplicationStatus;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class RecruiterDashboardService {
    private static final Duration MAX_RANGE = Duration.ofDays(366);
    private static final List<ApplicationStatus> FUNNEL_STATUSES = List.of(
        ApplicationStatus.APPLIED,
        ApplicationStatus.REVIEWING,
        ApplicationStatus.INTERVIEW,
        ApplicationStatus.OFFER,
        ApplicationStatus.HIRED
    );

    private final RecruiterDashboardRepository repository;
    private final CompanyClient companies;
    private final JobClient jobs;
    private final Clock clock;

    @Autowired
    public RecruiterDashboardService(
        RecruiterDashboardRepository repository,
        CompanyClient companies,
        JobClient jobs
    ) {
        this(repository, companies, jobs, Clock.systemUTC());
    }

    RecruiterDashboardService(
        RecruiterDashboardRepository repository,
        CompanyClient companies,
        JobClient jobs,
        Clock clock
    ) {
        this.repository = repository;
        this.companies = companies;
        this.jobs = jobs;
        this.clock = clock;
    }

    public RecruiterDashboardResponse get(
        UUID recruiterId,
        String authorization,
        UUID companyId,
        Instant from,
        Instant to,
        String timezone,
        DashboardGranularity granularity
    ) {
        Instant generatedAt = clock.instant();
        ZoneId zone = parseZone(timezone);
        DashboardRange range = resolveRange(
            from,
            to,
            zone,
            granularity,
            generatedAt
        );
        authorize(recruiterId, authorization, companyId);

        if (!repository.supportsTimezone(zone.getId())) {
            throw invalidTimezone();
        }

        DashboardSnapshot snapshot = repository.aggregate(
            companyId,
            range.from(),
            range.toExclusive(),
            granularity,
            zone.getId()
        );

        List<DashboardWarning> warnings = new ArrayList<>();
        ActiveJobs activeJobs = loadActiveJobs(companyId, warnings);
        long total = snapshot.statusCounts().values().stream()
            .mapToLong(Long::longValue)
            .sum();
        long hired = snapshot.statusCounts().get(ApplicationStatus.HIRED);

        return new RecruiterDashboardResponse(
            companyId,
            generatedAt,
            range,
            new DashboardSummary(
                activeJobs,
                total,
                hired,
                percentage(hired, total)
            ),
            snapshot.statusCounts(),
            snapshot.jobs().stream()
                .map(job -> new JobApplications(
                    job.jobId(),
                    job.jobTitle(),
                    job.totalApplications(),
                    job.statusCounts()
                ))
                .toList(),
            funnel(snapshot.funnelCounts()),
            timeSeries(snapshot, range, zone),
            snapshot.sourceCounts(),
            List.copyOf(warnings)
        );
    }

    private DashboardRange resolveRange(
        Instant from,
        Instant to,
        ZoneId zone,
        DashboardGranularity granularity,
        Instant now
    ) {
        if ((from == null) != (to == null)) {
            throw new BusinessException(
                "INCOMPLETE_STATS_RANGE",
                "from and to must be provided together",
                HttpStatus.BAD_REQUEST
            );
        }

        Instant resolvedFrom = from;
        Instant resolvedTo = to;
        if (from == null) {
            LocalDate today = now.atZone(zone).toLocalDate();
            resolvedFrom = today.minusDays(29)
                .atStartOfDay(zone)
                .toInstant();
            resolvedTo = today.plusDays(1)
                .atStartOfDay(zone)
                .toInstant();
        }

        if (!resolvedFrom.isBefore(resolvedTo)) {
            throw new BusinessException(
                "INVALID_STATS_RANGE",
                "from must be before to",
                HttpStatus.BAD_REQUEST
            );
        }
        if (Duration.between(resolvedFrom, resolvedTo).compareTo(MAX_RANGE) > 0) {
            throw new BusinessException(
                "STATS_RANGE_TOO_LARGE",
                "Statistics range must not exceed 366 days",
                HttpStatus.BAD_REQUEST,
                Map.of("maximumDays", 366)
            );
        }
        return new DashboardRange(
            resolvedFrom,
            resolvedTo,
            granularity,
            zone.getId()
        );
    }

    private ZoneId parseZone(String timezone) {
        try {
            return ZoneId.of(timezone);
        } catch (DateTimeException | NullPointerException exception) {
            throw invalidTimezone();
        }
    }

    private BusinessException invalidTimezone() {
        return new BusinessException(
            "INVALID_TIMEZONE",
            "timezone must be an IANA time-zone ID supported by PostgreSQL",
            HttpStatus.BAD_REQUEST
        );
    }

    private void authorize(
        UUID recruiterId,
        String authorization,
        UUID requestedCompanyId
    ) {
        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(recruiterId, authorization);
        if (
            !membership.canManageAllCompanyApplications() ||
            !requestedCompanyId.equals(membership.companyId())
        ) {
            throw new BusinessException(
                "APPLICATION_ACCESS_DENIED",
                "You cannot view application statistics for this company",
                HttpStatus.FORBIDDEN
            );
        }
    }

    private ActiveJobs loadActiveJobs(
        UUID companyId,
        List<DashboardWarning> warnings
    ) {
        try {
            ActiveJobStats stats = jobs.getActiveJobStats(companyId);
            return new ActiveJobs(stats.activeJobCount(), true);
        } catch (BusinessException exception) {
            if (!"JOB_SERVICE_UNAVAILABLE".equals(exception.code())) {
                throw exception;
            }
            warnings.add(new DashboardWarning(
                exception.code(),
                exception.getMessage()
            ));
            return new ActiveJobs(null, false);
        }
    }

    private List<FunnelStage> funnel(
        Map<ApplicationStatus, Long> counts
    ) {
        List<FunnelStage> result = new ArrayList<>();
        Long previous = null;
        for (ApplicationStatus status : FUNNEL_STATUSES) {
            long count = counts.getOrDefault(status, 0L);
            result.add(new FunnelStage(
                status,
                count,
                previous == null ? null : percentage(count, previous)
            ));
            previous = count;
        }
        return List.copyOf(result);
    }

    private List<TimeSeriesPoint> timeSeries(
        DashboardSnapshot snapshot,
        DashboardRange range,
        ZoneId zone
    ) {
        List<TimeSeriesPoint> result = new ArrayList<>();
        LocalDate bucket = firstBucket(
            range.from().atZone(zone).toLocalDate(),
            range.granularity()
        );
        while (bucket.atStartOfDay(zone).toInstant().isBefore(
            range.toExclusive()
        )) {
            result.add(new TimeSeriesPoint(
                bucket,
                snapshot.timeline().getOrDefault(bucket, 0L)
            ));
            bucket = nextBucket(bucket, range.granularity());
        }
        return List.copyOf(result);
    }

    private LocalDate firstBucket(
        LocalDate date,
        DashboardGranularity granularity
    ) {
        return switch (granularity) {
            case DAY -> date;
            case WEEK -> date.with(
                TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)
            );
            case MONTH -> date.withDayOfMonth(1);
        };
    }

    private LocalDate nextBucket(
        LocalDate bucket,
        DashboardGranularity granularity
    ) {
        return switch (granularity) {
            case DAY -> bucket.plusDays(1);
            case WEEK -> bucket.plusWeeks(1);
            case MONTH -> bucket.plusMonths(1);
        };
    }

    private BigDecimal percentage(long numerator, long denominator) {
        if (denominator == 0) return null;
        return BigDecimal.valueOf(numerator)
            .multiply(BigDecimal.valueOf(100))
            .divide(BigDecimal.valueOf(denominator), 2, RoundingMode.HALF_UP);
    }
}
