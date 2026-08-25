package com.recruitment.application.dashboard;

import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class RecruiterDashboardRepository {
    private static final String STATUS_COUNTS_SQL = """
        SELECT status, COUNT(*) AS total
        FROM application.applications
        WHERE company_id = :companyId
          AND applied_at >= :from
          AND applied_at < :toExclusive
        GROUP BY status
        """;

    private static final String SOURCE_COUNTS_SQL = """
        SELECT source, COUNT(*) AS total
        FROM application.applications
        WHERE company_id = :companyId
          AND applied_at >= :from
          AND applied_at < :toExclusive
        GROUP BY source
        """;

    private static final String JOB_COUNTS_SQL = """
        WITH cohort AS (
            SELECT id, job_id, job_title, status, applied_at
            FROM application.applications
            WHERE company_id = :companyId
              AND applied_at >= :from
              AND applied_at < :toExclusive
        ),
        latest_job_titles AS (
            SELECT DISTINCT ON (job_id) job_id, job_title
            FROM cohort
            ORDER BY job_id, applied_at DESC, id DESC
        )
        SELECT cohort.job_id,
               latest_job_titles.job_title,
               cohort.status,
               COUNT(*) AS total
        FROM cohort
        JOIN latest_job_titles USING (job_id)
        GROUP BY cohort.job_id, latest_job_titles.job_title, cohort.status
        """;

    private static final String FUNNEL_COUNTS_SQL = """
        SELECT history.to_status, COUNT(DISTINCT history.application_id) AS total
        FROM application.application_history history
        JOIN application.applications application
          ON application.id = history.application_id
        WHERE application.company_id = :companyId
          AND application.applied_at >= :from
          AND application.applied_at < :toExclusive
          AND history.to_status IN (
              'APPLIED', 'REVIEWING', 'INTERVIEW', 'OFFER', 'HIRED'
          )
        GROUP BY history.to_status
        """;

    private static final String TIMEZONE_EXISTS_SQL = """
        SELECT EXISTS (
            SELECT 1
            FROM pg_timezone_names
            WHERE name = :timezone
        )
        """;

    private static final String TIMELINE_DAY_SQL = """
        SELECT CAST(
                   date_trunc('day', applied_at AT TIME ZONE :timezone)
                   AS date
               ) AS bucket_start,
               COUNT(*) AS total
        FROM application.applications
        WHERE company_id = :companyId
          AND applied_at >= :from
          AND applied_at < :toExclusive
        GROUP BY bucket_start
        ORDER BY bucket_start
        """;

    private static final String TIMELINE_WEEK_SQL = """
        SELECT CAST(
                   date_trunc('week', applied_at AT TIME ZONE :timezone)
                   AS date
               ) AS bucket_start,
               COUNT(*) AS total
        FROM application.applications
        WHERE company_id = :companyId
          AND applied_at >= :from
          AND applied_at < :toExclusive
        GROUP BY bucket_start
        ORDER BY bucket_start
        """;

    private static final String TIMELINE_MONTH_SQL = """
        SELECT CAST(
                   date_trunc('month', applied_at AT TIME ZONE :timezone)
                   AS date
               ) AS bucket_start,
               COUNT(*) AS total
        FROM application.applications
        WHERE company_id = :companyId
          AND applied_at >= :from
          AND applied_at < :toExclusive
        GROUP BY bucket_start
        ORDER BY bucket_start
        """;

    private final NamedParameterJdbcTemplate jdbc;

    public RecruiterDashboardRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public boolean supportsTimezone(String timezone) {
        Boolean supported = jdbc.queryForObject(
            TIMEZONE_EXISTS_SQL,
            Map.of("timezone", timezone),
            Boolean.class
        );
        return Boolean.TRUE.equals(supported);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public DashboardSnapshot aggregate(
        UUID companyId,
        Instant from,
        Instant toExclusive,
        DashboardGranularity granularity,
        String timezone
    ) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
            .addValue("companyId", companyId)
            .addValue("from", Timestamp.from(from))
            .addValue("toExclusive", Timestamp.from(toExclusive))
            .addValue("timezone", timezone);

        Map<ApplicationStatus, Long> statusCounts = statusCounts(parameters);
        Map<ApplicationSource, Long> sourceCounts = sourceCounts(parameters);
        List<JobSnapshot> jobs = jobCounts(parameters);
        Map<ApplicationStatus, Long> funnelCounts = funnelCounts(parameters);
        Map<LocalDate, Long> timeline = timeline(parameters, granularity);
        return new DashboardSnapshot(
            statusCounts,
            sourceCounts,
            jobs,
            funnelCounts,
            timeline
        );
    }

    private Map<ApplicationStatus, Long> statusCounts(
        MapSqlParameterSource parameters
    ) {
        Map<ApplicationStatus, Long> counts = zeroStatusCounts();
        jdbc.query(STATUS_COUNTS_SQL, parameters, row -> {
            counts.put(
                ApplicationStatus.valueOf(row.getString("status")),
                row.getLong("total")
            );
        });
        return counts;
    }

    private Map<ApplicationSource, Long> sourceCounts(
        MapSqlParameterSource parameters
    ) {
        Map<ApplicationSource, Long> counts = new LinkedHashMap<>();
        for (ApplicationSource source : ApplicationSource.values()) {
            counts.put(source, 0L);
        }
        jdbc.query(SOURCE_COUNTS_SQL, parameters, row -> {
            counts.put(
                ApplicationSource.valueOf(row.getString("source")),
                row.getLong("total")
            );
        });
        return counts;
    }

    private List<JobSnapshot> jobCounts(
        MapSqlParameterSource parameters
    ) {
        Map<UUID, MutableJobSnapshot> jobs = new LinkedHashMap<>();
        jdbc.query(JOB_COUNTS_SQL, parameters, row -> {
            UUID jobId = row.getObject("job_id", UUID.class);
            String jobTitle = row.getString("job_title");
            MutableJobSnapshot job = jobs.computeIfAbsent(
                jobId,
                ignored -> new MutableJobSnapshot(jobId, jobTitle)
            );
            job.add(
                ApplicationStatus.valueOf(row.getString("status")),
                row.getLong("total")
            );
        });
        return jobs.values().stream()
            .map(MutableJobSnapshot::snapshot)
            .sorted(
                Comparator.comparingLong(JobSnapshot::totalApplications)
                    .reversed()
                    .thenComparing(JobSnapshot::jobId)
            )
            .toList();
    }

    private Map<ApplicationStatus, Long> funnelCounts(
        MapSqlParameterSource parameters
    ) {
        Map<ApplicationStatus, Long> counts = new EnumMap<>(
            ApplicationStatus.class
        );
        jdbc.query(FUNNEL_COUNTS_SQL, parameters, row -> {
            counts.put(
                ApplicationStatus.valueOf(row.getString("to_status")),
                row.getLong("total")
            );
        });
        return counts;
    }

    private Map<LocalDate, Long> timeline(
        MapSqlParameterSource parameters,
        DashboardGranularity granularity
    ) {
        Map<LocalDate, Long> counts = new LinkedHashMap<>();
        jdbc.query(timelineSql(granularity), parameters, row -> {
            counts.put(
                row.getObject("bucket_start", LocalDate.class),
                row.getLong("total")
            );
        });
        return counts;
    }

    private String timelineSql(DashboardGranularity granularity) {
        return switch (granularity) {
            case DAY -> TIMELINE_DAY_SQL;
            case WEEK -> TIMELINE_WEEK_SQL;
            case MONTH -> TIMELINE_MONTH_SQL;
        };
    }

    private static Map<ApplicationStatus, Long> zeroStatusCounts() {
        Map<ApplicationStatus, Long> counts = new LinkedHashMap<>();
        for (ApplicationStatus status : ApplicationStatus.values()) {
            counts.put(status, 0L);
        }
        return counts;
    }

    public record DashboardSnapshot(
        Map<ApplicationStatus, Long> statusCounts,
        Map<ApplicationSource, Long> sourceCounts,
        List<JobSnapshot> jobs,
        Map<ApplicationStatus, Long> funnelCounts,
        Map<LocalDate, Long> timeline
    ) {}

    public record JobSnapshot(
        UUID jobId,
        String jobTitle,
        long totalApplications,
        Map<ApplicationStatus, Long> statusCounts
    ) {}

    private static final class MutableJobSnapshot {
        private final UUID jobId;
        private final String jobTitle;
        private final Map<ApplicationStatus, Long> statusCounts;
        private long totalApplications;

        private MutableJobSnapshot(UUID jobId, String jobTitle) {
            this.jobId = jobId;
            this.jobTitle = jobTitle;
            this.statusCounts = zeroStatusCounts();
        }

        private void add(ApplicationStatus status, long count) {
            statusCounts.put(status, count);
            totalApplications += count;
        }

        private JobSnapshot snapshot() {
            return new JobSnapshot(
                jobId,
                jobTitle,
                totalApplications,
                statusCounts
            );
        }
    }
}
