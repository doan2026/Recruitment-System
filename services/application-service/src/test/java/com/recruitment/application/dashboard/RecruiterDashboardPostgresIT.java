package com.recruitment.application.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.ActiveJobStats;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.mockito.Mockito.when;

@Testcontainers
@DataJpaTest(properties = {
    "spring.jpa.hibernate.ddl-auto=validate",
    "spring.jpa.properties.hibernate.default_schema=application",
    "spring.flyway.enabled=true",
    "spring.flyway.create-schemas=true",
    "spring.flyway.default-schema=application",
    "spring.flyway.schemas=application"
})
@AutoConfigureTestDatabase(
    replace = AutoConfigureTestDatabase.Replace.NONE
)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import(RecruiterDashboardRepository.class)
class RecruiterDashboardPostgresIT {
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000002"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID JOB_ONE_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final UUID JOB_TWO_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000002"
    );
    private static final UUID OTHER_COMPANY_JOB_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000003"
    );
    private static final String AUTHORIZATION = "Bearer integration-test";
    private static final Instant FROM = Instant.parse(
        "2026-08-24T17:00:00Z"
    );
    private static final Instant TO = Instant.parse(
        "2026-08-26T17:00:00Z"
    );
    private static final Instant NOW = Instant.parse(
        "2026-08-26T08:00:00Z"
    );

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("recruitment")
            .withUsername("recruitment")
            .withPassword("recruitment");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private RecruiterDashboardRepository repository;

    @Autowired
    private JdbcTemplate jdbc;

    @MockBean
    private CompanyClient companies;

    @MockBean
    private JobClient jobs;

    private RecruiterDashboardService dashboard;

    @BeforeEach
    void setUp() {
        jdbc.execute(
            """
            TRUNCATE TABLE
                application.offers,
                application.evaluations,
                application.application_event_outbox,
                application.application_history,
                application.bookmarks,
                application.application_cv_usage,
                application.applications
            CASCADE
            """
        );
        dashboard = new RecruiterDashboardService(
            repository,
            companies,
            jobs,
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void emptyCompanyReturnsStableZeroBucketsAndEnums() {
        allowDashboard(2L);

        RecruiterDashboardResponse response = load("Asia/Ho_Chi_Minh");

        assertThat(response.summary().activeJobs().count()).isEqualTo(2L);
        assertThat(response.summary().activeJobs().available()).isTrue();
        assertThat(response.summary().totalApplications()).isZero();
        assertThat(response.summary().hiredApplications()).isZero();
        assertThat(response.summary().hiredRatePercent()).isNull();
        assertThat(response.statusCounts())
            .containsOnlyKeys(ApplicationStatus.values());
        assertThat(response.statusCounts().values())
            .allMatch(count -> count == 0L);
        assertThat(response.sourceBreakdown())
            .containsOnlyKeys(ApplicationSource.values());
        assertThat(response.sourceBreakdown().values())
            .allMatch(count -> count == 0L);
        assertThat(response.applicationsByJob()).isEmpty();
        assertThat(response.funnel()).hasSize(5)
            .allMatch(stage ->
                stage.count() == 0L &&
                stage.rateFromPreviousPercent() == null
            );
        assertThat(response.timeSeries()).hasSize(2)
            .allMatch(point -> point.count() == 0L);
        assertThat(response.warnings()).isEmpty();
    }

    @Test
    void aggregatesCohortWithExclusiveBoundsCompanyIsolationAndHistoryFunnel() {
        insertFullFixture();
        allowDashboard(3L);

        RecruiterDashboardResponse vietnam = load("Asia/Ho_Chi_Minh");

        assertThat(vietnam.summary().totalApplications()).isEqualTo(7L);
        assertThat(vietnam.summary().hiredApplications()).isEqualTo(1L);
        assertThat(vietnam.summary().hiredRatePercent())
            .isEqualByComparingTo("14.29");
        for (ApplicationStatus status : ApplicationStatus.values()) {
            assertThat(vietnam.statusCounts().get(status)).isEqualTo(1L);
        }
        assertThat(vietnam.sourceBreakdown())
            .containsEntry(ApplicationSource.SEARCH, 3L)
            .containsEntry(ApplicationSource.AI_RECOMMENDATION, 1L)
            .containsEntry(ApplicationSource.COMPANY_PAGE, 1L)
            .containsEntry(ApplicationSource.SHARED_LINK, 1L)
            .containsEntry(ApplicationSource.OTHER, 1L);

        assertThat(vietnam.applicationsByJob()).hasSize(2);
        RecruiterDashboardResponse.JobApplications first =
            vietnam.applicationsByJob().get(0);
        RecruiterDashboardResponse.JobApplications second =
            vietnam.applicationsByJob().get(1);
        assertThat(first.jobId()).isEqualTo(JOB_ONE_ID);
        assertThat(first.totalApplications()).isEqualTo(4L);
        assertThat(first.statusCounts())
            .containsEntry(ApplicationStatus.APPLIED, 1L)
            .containsEntry(ApplicationStatus.REVIEWING, 1L)
            .containsEntry(ApplicationStatus.INTERVIEW, 1L)
            .containsEntry(ApplicationStatus.OFFER, 1L);
        assertThat(second.jobId()).isEqualTo(JOB_TWO_ID);
        assertThat(second.totalApplications()).isEqualTo(3L);
        assertThat(second.statusCounts())
            .containsEntry(ApplicationStatus.HIRED, 1L)
            .containsEntry(ApplicationStatus.REJECTED, 1L)
            .containsEntry(ApplicationStatus.WITHDRAWN, 1L);

        assertThat(vietnam.funnel()).extracting(
            RecruiterDashboardResponse.FunnelStage::status
        ).containsExactly(
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED
        );
        assertThat(vietnam.funnel()).extracting(
            RecruiterDashboardResponse.FunnelStage::count
        ).containsExactly(7L, 5L, 3L, 2L, 1L);
        assertThat(vietnam.funnel().get(1).rateFromPreviousPercent())
            .isEqualByComparingTo("71.43");
        assertThat(vietnam.funnel().get(2).rateFromPreviousPercent())
            .isEqualByComparingTo("60.00");
        assertThat(vietnam.funnel().get(3).rateFromPreviousPercent())
            .isEqualByComparingTo("66.67");
        assertThat(vietnam.funnel().get(4).rateFromPreviousPercent())
            .isEqualByComparingTo("50.00");
        assertThat(vietnam.timeSeries()).extracting(
            RecruiterDashboardResponse.TimeSeriesPoint::count
        ).containsExactly(3L, 4L);

        RecruiterDashboardResponse utc = load("UTC");
        assertThat(utc.timeSeries()).extracting(
            RecruiterDashboardResponse.TimeSeriesPoint::count
        ).containsExactly(1L, 4L, 2L);
    }

    @Test
    void funnelIncludesStagesReachedAfterTheCohortRangeEnds() {
        insertApplication(
            11,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.HIRED,
            ApplicationSource.SEARCH,
            FROM.plusSeconds(1),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED
        );
        jdbc.update(
            """
            UPDATE application.application_history
            SET changed_at = ?
            WHERE application_id = ?
              AND to_status = ?
            """,
            Timestamp.from(TO.plusSeconds(1)),
            applicationId(11),
            ApplicationStatus.HIRED.name()
        );
        dashboard = new RecruiterDashboardService(
            repository,
            companies,
            jobs,
            Clock.fixed(TO.plusSeconds(2), ZoneOffset.UTC)
        );
        allowDashboard(1L);

        RecruiterDashboardResponse response = load("UTC");

        assertThat(response.summary().totalApplications()).isEqualTo(1L);
        assertThat(response.summary().hiredApplications()).isEqualTo(1L);
        assertThat(response.funnel()).extracting(
            RecruiterDashboardResponse.FunnelStage::count
        ).containsExactly(1L, 1L, 1L, 1L, 1L);
    }

    @Test
    void groupsPostgresTimelineByWeekAndMonthInRequestedTimezone() {
        Instant bucketFrom = Instant.parse("2026-07-19T17:00:00Z");
        Instant bucketTo = Instant.parse("2026-08-02T17:00:00Z");
        insertApplication(
            20,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            Instant.parse("2026-07-26T16:59:59.999Z"),
            ApplicationStatus.APPLIED
        );
        insertApplication(
            21,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            Instant.parse("2026-07-26T17:00:00Z"),
            ApplicationStatus.APPLIED
        );
        insertApplication(
            22,
            JOB_TWO_ID,
            COMPANY_ID,
            "Platform Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            Instant.parse("2026-07-31T17:00:00Z"),
            ApplicationStatus.APPLIED
        );
        allowDashboard(2L);

        RecruiterDashboardResponse weekly = loadRange(
            bucketFrom,
            bucketTo,
            "Asia/Ho_Chi_Minh",
            DashboardGranularity.WEEK
        );
        RecruiterDashboardResponse monthly = loadRange(
            bucketFrom,
            bucketTo,
            "Asia/Ho_Chi_Minh",
            DashboardGranularity.MONTH
        );

        assertThat(weekly.timeSeries()).extracting(
            RecruiterDashboardResponse.TimeSeriesPoint::bucketStart
        ).containsExactly(
            LocalDate.of(2026, 7, 20),
            LocalDate.of(2026, 7, 27)
        );
        assertThat(weekly.timeSeries()).extracting(
            RecruiterDashboardResponse.TimeSeriesPoint::count
        ).containsExactly(1L, 2L);
        assertThat(monthly.timeSeries()).extracting(
            RecruiterDashboardResponse.TimeSeriesPoint::bucketStart
        ).containsExactly(
            LocalDate.of(2026, 7, 1),
            LocalDate.of(2026, 8, 1)
        );
        assertThat(monthly.timeSeries()).extracting(
            RecruiterDashboardResponse.TimeSeriesPoint::count
        ).containsExactly(2L, 1L);
    }

    @Test
    void handlesTheTwentyThreeHourSpringDstDay() {
        Instant dstFrom = Instant.parse("2026-03-08T05:00:00Z");
        Instant dstTo = Instant.parse("2026-03-09T04:00:00Z");
        insertApplication(
            30,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            dstFrom,
            ApplicationStatus.APPLIED
        );
        insertApplication(
            31,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            Instant.parse("2026-03-09T03:59:59.999Z"),
            ApplicationStatus.APPLIED
        );
        insertApplication(
            32,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            dstTo,
            ApplicationStatus.APPLIED
        );
        allowDashboard(1L);

        RecruiterDashboardResponse response = loadRange(
            dstFrom,
            dstTo,
            "America/New_York",
            DashboardGranularity.DAY
        );

        assertThat(response.summary().totalApplications()).isEqualTo(2L);
        assertThat(response.timeSeries()).containsExactly(
            new RecruiterDashboardResponse.TimeSeriesPoint(
                LocalDate.of(2026, 3, 8),
                2L
            )
        );
    }

    @Test
    void flywayCreatesDashboardQueryIndexes() {
        List<String> indexes = jdbc.queryForList(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'application'
            ORDER BY indexname
            """,
            String.class
        );

        assertThat(indexes).contains(
            "applications_company_applied_idx",
            "application_history_application_status_idx"
        );
    }

    private RecruiterDashboardResponse load(String timezone) {
        return dashboard.get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            FROM,
            TO,
            timezone,
            DashboardGranularity.DAY
        );
    }

    private RecruiterDashboardResponse loadRange(
        Instant from,
        Instant to,
        String timezone,
        DashboardGranularity granularity
    ) {
        return dashboard.get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            from,
            to,
            timezone,
            granularity
        );
    }

    private void allowDashboard(long activeJobs) {
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
        when(jobs.getActiveJobStats(COMPANY_ID)).thenReturn(
            new ActiveJobStats(COMPANY_ID, activeJobs)
        );
    }

    private void insertFullFixture() {
        insertApplication(
            1,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            FROM,
            ApplicationStatus.APPLIED
        );
        insertApplication(
            2,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.REVIEWING,
            ApplicationSource.AI_RECOMMENDATION,
            Instant.parse("2026-08-25T00:00:00Z"),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING
        );
        insertApplication(
            3,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.INTERVIEW,
            ApplicationSource.COMPANY_PAGE,
            Instant.parse("2026-08-25T16:59:59.999Z"),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW
        );
        insertApplication(
            4,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.OFFER,
            ApplicationSource.SHARED_LINK,
            Instant.parse("2026-08-25T17:00:00Z"),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER
        );
        insertApplication(
            5,
            JOB_TWO_ID,
            COMPANY_ID,
            "Platform Engineer",
            ApplicationStatus.HIRED,
            ApplicationSource.SEARCH,
            Instant.parse("2026-08-25T18:00:00Z"),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED
        );
        insertApplication(
            6,
            JOB_TWO_ID,
            COMPANY_ID,
            "Platform Engineer",
            ApplicationStatus.REJECTED,
            ApplicationSource.OTHER,
            Instant.parse("2026-08-26T00:00:00Z"),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REJECTED
        );
        insertApplication(
            7,
            JOB_TWO_ID,
            COMPANY_ID,
            "Platform Engineer",
            ApplicationStatus.WITHDRAWN,
            ApplicationSource.SEARCH,
            Instant.parse("2026-08-26T16:59:59.999Z"),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.WITHDRAWN
        );

        insertApplication(
            8,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.APPLIED,
            ApplicationSource.SEARCH,
            TO,
            ApplicationStatus.APPLIED
        );
        insertApplication(
            9,
            JOB_ONE_ID,
            COMPANY_ID,
            "Backend Engineer",
            ApplicationStatus.HIRED,
            ApplicationSource.SEARCH,
            FROM.minusMillis(1),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED
        );
        insertApplication(
            10,
            OTHER_COMPANY_JOB_ID,
            OTHER_COMPANY_ID,
            "Other Company Engineer",
            ApplicationStatus.HIRED,
            ApplicationSource.SEARCH,
            Instant.parse("2026-08-25T12:00:00Z"),
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED
        );
    }

    private void insertApplication(
        int sequence,
        UUID jobId,
        UUID companyId,
        String jobTitle,
        ApplicationStatus currentStatus,
        ApplicationSource source,
        Instant appliedAt,
        ApplicationStatus... history
    ) {
        UUID applicationId = applicationId(sequence);
        jdbc.update(
            """
            INSERT INTO application.applications (
                id,
                job_id,
                company_id,
                candidate_id,
                recruiter_id,
                cv_id,
                job_title,
                status,
                source,
                applied_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            applicationId,
            jobId,
            companyId,
            candidateId(sequence),
            RECRUITER_ID,
            cvId(sequence),
            jobTitle,
            currentStatus.name(),
            source.name(),
            Timestamp.from(appliedAt),
            Timestamp.from(appliedAt)
        );
        insertHistory(applicationId, appliedAt, history);
    }

    private void insertHistory(
        UUID applicationId,
        Instant changedAt,
        ApplicationStatus... statuses
    ) {
        ApplicationStatus previous = null;
        for (int index = 0; index < statuses.length; index++) {
            ApplicationStatus status = statuses[index];
            UUID historyId = UUID.nameUUIDFromBytes(
                (applicationId + ":" + index + ":" + status.name())
                    .getBytes(StandardCharsets.UTF_8)
            );
            jdbc.update(
                """
                INSERT INTO application.application_history (
                    id,
                    application_id,
                    from_status,
                    to_status,
                    changed_by,
                    note,
                    changed_at
                ) VALUES (?, ?, ?, ?, ?, NULL, ?)
                """,
                historyId,
                applicationId,
                previous == null ? null : previous.name(),
                status.name(),
                RECRUITER_ID,
                Timestamp.from(changedAt)
            );
            previous = status;
        }
    }

    private UUID applicationId(int sequence) {
        return UUID.fromString(
            "40000000-0000-0000-0000-%012d".formatted(sequence)
        );
    }

    private UUID candidateId(int sequence) {
        return UUID.fromString(
            "50000000-0000-0000-0000-%012d".formatted(sequence)
        );
    }

    private UUID cvId(int sequence) {
        return UUID.fromString(
            "60000000-0000-0000-0000-%012d".formatted(sequence)
        );
    }
}
