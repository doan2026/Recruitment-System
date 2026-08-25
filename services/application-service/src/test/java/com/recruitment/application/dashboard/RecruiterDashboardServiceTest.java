package com.recruitment.application.dashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.ActiveJobStats;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.dashboard.RecruiterDashboardRepository.DashboardSnapshot;
import com.recruitment.application.dashboard.RecruiterDashboardRepository.JobSnapshot;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

@ExtendWith(MockitoExtension.class)
class RecruiterDashboardServiceTest {
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
    private static final String AUTHORIZATION = "Bearer dashboard-token";
    private static final Instant NOW = Instant.parse(
        "2026-08-25T10:15:30Z"
    );
    private static final Instant FROM = Instant.parse(
        "2026-08-24T17:00:00Z"
    );
    private static final Instant TO = Instant.parse(
        "2026-08-26T17:00:00Z"
    );

    @Mock
    private RecruiterDashboardRepository repository;

    @Mock
    private CompanyClient companies;

    @Mock
    private JobClient jobs;

    private RecruiterDashboardService dashboard;

    @BeforeEach
    void setUp() {
        lenient().when(repository.supportsTimezone(anyString()))
            .thenReturn(true);
        dashboard = new RecruiterDashboardService(
            repository,
            companies,
            jobs,
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void memberAndOwnerCanViewCompanyWideStatistics(
        CompanyMemberRole role
    ) {
        allow(role, COMPANY_ID);
        when(repository.aggregate(
            COMPANY_ID,
            FROM,
            TO,
            DashboardGranularity.DAY,
            "Asia/Ho_Chi_Minh"
        )).thenReturn(fullSnapshot());
        when(jobs.getActiveJobStats(COMPANY_ID))
            .thenReturn(new ActiveJobStats(COMPANY_ID, 3L));

        RecruiterDashboardResponse response = dashboard.get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            FROM,
            TO,
            "Asia/Ho_Chi_Minh",
            DashboardGranularity.DAY
        );

        assertThat(response.companyId()).isEqualTo(COMPANY_ID);
        assertThat(response.generatedAt()).isEqualTo(NOW);
        assertThat(response.summary().activeJobs().count()).isEqualTo(3L);
        assertThat(response.summary().activeJobs().available()).isTrue();
        assertThat(response.summary().totalApplications()).isEqualTo(7L);
        assertThat(response.summary().hiredApplications()).isEqualTo(1L);
        assertThat(response.summary().hiredRatePercent())
            .isEqualByComparingTo("14.29");
        assertThat(response.applicationsByJob()).hasSize(1);
        assertThat(response.applicationsByJob().getFirst().jobId())
            .isEqualTo(JOB_ONE_ID);
        assertThat(response.funnel()).extracting(
            RecruiterDashboardResponse.FunnelStage::count
        ).containsExactly(7L, 5L, 3L, 2L, 1L);
        assertThat(response.funnel().get(0).rateFromPreviousPercent()).isNull();
        assertThat(response.funnel().get(1).rateFromPreviousPercent())
            .isEqualByComparingTo("71.43");
        assertThat(response.funnel().get(2).rateFromPreviousPercent())
            .isEqualByComparingTo("60.00");
        assertThat(response.funnel().get(3).rateFromPreviousPercent())
            .isEqualByComparingTo("66.67");
        assertThat(response.funnel().get(4).rateFromPreviousPercent())
            .isEqualByComparingTo("50.00");
        assertThat(response.timeSeries()).extracting(
            RecruiterDashboardResponse.TimeSeriesPoint::count
        ).containsExactly(3L, 4L);
        assertThat(response.warnings()).isEmpty();
    }

    @Test
    void companyMismatchIsDeniedBeforeAnyDataOrJobQuery() {
        allow(CompanyMemberRole.MEMBER, OTHER_COMPANY_ID);

        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                FROM,
                TO,
                "UTC",
                DashboardGranularity.DAY
            ),
            "APPLICATION_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );

        verifyNoInteractions(repository, jobs);
    }

    @Test
    void defaultRangeUsesThirtyLocalCalendarDaysFromInjectedClock() {
        allow(CompanyMemberRole.OWNER, COMPANY_ID);
        when(repository.aggregate(
            eq(COMPANY_ID),
            any(Instant.class),
            any(Instant.class),
            eq(DashboardGranularity.DAY),
            eq("Asia/Ho_Chi_Minh")
        )).thenReturn(emptySnapshot());
        when(jobs.getActiveJobStats(COMPANY_ID))
            .thenReturn(new ActiveJobStats(COMPANY_ID, 0L));

        RecruiterDashboardResponse response = dashboard.get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            null,
            null,
            "Asia/Ho_Chi_Minh",
            DashboardGranularity.DAY
        );

        Instant expectedFrom = Instant.parse("2026-07-26T17:00:00Z");
        Instant expectedTo = Instant.parse("2026-08-25T17:00:00Z");
        assertThat(response.range().from()).isEqualTo(expectedFrom);
        assertThat(response.range().toExclusive()).isEqualTo(expectedTo);
        assertThat(response.timeSeries()).hasSize(30);
        assertThat(response.timeSeries().getFirst().bucketStart())
            .isEqualTo(LocalDate.of(2026, 7, 27));
        assertThat(response.timeSeries().getLast().bucketStart())
            .isEqualTo(LocalDate.of(2026, 8, 25));
        assertThat(response.timeSeries())
            .allMatch(point -> point.count() == 0L);
        verify(repository).aggregate(
            COMPANY_ID,
            expectedFrom,
            expectedTo,
            DashboardGranularity.DAY,
            "Asia/Ho_Chi_Minh"
        );
    }

    @Test
    void incompleteRangeIsRejectedBeforeExternalOrDatabaseCalls() {
        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                FROM,
                null,
                "UTC",
                DashboardGranularity.DAY
            ),
            "INCOMPLETE_STATS_RANGE",
            HttpStatus.BAD_REQUEST
        );
        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                null,
                TO,
                "UTC",
                DashboardGranularity.DAY
            ),
            "INCOMPLETE_STATS_RANGE",
            HttpStatus.BAD_REQUEST
        );

        verifyNoInteractions(companies, repository, jobs);
    }

    @Test
    void emptyAndReversedRangesAreRejected() {
        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                FROM,
                FROM,
                "UTC",
                DashboardGranularity.DAY
            ),
            "INVALID_STATS_RANGE",
            HttpStatus.BAD_REQUEST
        );
        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                TO,
                FROM,
                "UTC",
                DashboardGranularity.DAY
            ),
            "INVALID_STATS_RANGE",
            HttpStatus.BAD_REQUEST
        );

        verifyNoInteractions(companies, repository, jobs);
    }

    @Test
    void rangeLongerThan366DaysIsRejected() {
        Instant to = FROM.plusSeconds(367L * 24 * 60 * 60);

        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                FROM,
                to,
                "UTC",
                DashboardGranularity.MONTH
            ),
            "STATS_RANGE_TOO_LARGE",
            HttpStatus.BAD_REQUEST
        );

        verifyNoInteractions(companies, repository, jobs);
    }

    @Test
    void invalidTimezoneIsRejectedBeforeExternalOrDatabaseCalls() {
        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                FROM,
                TO,
                "Mars/Olympus_Mons",
                DashboardGranularity.DAY
            ),
            "INVALID_TIMEZONE",
            HttpStatus.BAD_REQUEST
        );

        verifyNoInteractions(companies, repository, jobs);
    }

    @Test
    void javaZoneUnsupportedByPostgresIsRejectedBeforeAggregation() {
        allow(CompanyMemberRole.OWNER, COMPANY_ID);
        when(repository.supportsTimezone("+07:00"))
            .thenReturn(false);

        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                FROM,
                TO,
                "+07:00",
                DashboardGranularity.DAY
            ),
            "INVALID_TIMEZONE",
            HttpStatus.BAD_REQUEST
        );

        verify(repository).supportsTimezone("+07:00");
        verifyNoInteractions(jobs);
    }

    @Test
    void jobServiceFailureReturnsLocalStatisticsWithExplicitWarning() {
        allow(CompanyMemberRole.MEMBER, COMPANY_ID);
        when(repository.aggregate(
            COMPANY_ID,
            FROM,
            TO,
            DashboardGranularity.DAY,
            "UTC"
        )).thenReturn(emptySnapshot());
        when(jobs.getActiveJobStats(COMPANY_ID)).thenThrow(
            new BusinessException(
                "JOB_SERVICE_UNAVAILABLE",
                "Cannot load active job statistics",
                HttpStatus.SERVICE_UNAVAILABLE
            )
        );

        RecruiterDashboardResponse response = dashboard.get(
            RECRUITER_ID,
            AUTHORIZATION,
            COMPANY_ID,
            FROM,
            TO,
            "UTC",
            DashboardGranularity.DAY
        );

        assertThat(response.summary().activeJobs().available()).isFalse();
        assertThat(response.summary().activeJobs().count()).isNull();
        assertThat(response.summary().totalApplications()).isZero();
        assertThat(response.warnings()).containsExactly(
            new RecruiterDashboardResponse.DashboardWarning(
                "JOB_SERVICE_UNAVAILABLE",
                "Cannot load active job statistics"
            )
        );
    }

    @Test
    void invalidJobServiceResponseIsNotHiddenByFailSoftFallback() {
        allow(CompanyMemberRole.MEMBER, COMPANY_ID);
        when(repository.aggregate(
            COMPANY_ID,
            FROM,
            TO,
            DashboardGranularity.DAY,
            "UTC"
        )).thenReturn(emptySnapshot());
        when(jobs.getActiveJobStats(COMPANY_ID)).thenThrow(
            new BusinessException(
                "JOB_SERVICE_INVALID_RESPONSE",
                "Job Service returned an invalid response",
                HttpStatus.BAD_GATEWAY
            )
        );

        assertBusinessError(
            () -> dashboard.get(
                RECRUITER_ID,
                AUTHORIZATION,
                COMPANY_ID,
                FROM,
                TO,
                "UTC",
                DashboardGranularity.DAY
            ),
            "JOB_SERVICE_INVALID_RESPONSE",
            HttpStatus.BAD_GATEWAY
        );
    }

    private void allow(CompanyMemberRole role, UUID companyId) {
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(companyId, role));
    }

    private DashboardSnapshot emptySnapshot() {
        return new DashboardSnapshot(
            zeroStatusCounts(),
            zeroSourceCounts(),
            List.of(),
            Map.of(),
            Map.of()
        );
    }

    private DashboardSnapshot fullSnapshot() {
        Map<ApplicationStatus, Long> statuses = zeroStatusCounts();
        for (ApplicationStatus status : ApplicationStatus.values()) {
            statuses.put(status, 1L);
        }
        Map<ApplicationSource, Long> sources = zeroSourceCounts();
        sources.put(ApplicationSource.SEARCH, 3L);
        sources.put(ApplicationSource.AI_RECOMMENDATION, 1L);
        sources.put(ApplicationSource.COMPANY_PAGE, 1L);
        sources.put(ApplicationSource.SHARED_LINK, 1L);
        sources.put(ApplicationSource.OTHER, 1L);

        return new DashboardSnapshot(
            statuses,
            sources,
            List.of(new JobSnapshot(
                JOB_ONE_ID,
                "Backend Engineer",
                7L,
                statuses
            )),
            Map.of(
                ApplicationStatus.APPLIED, 7L,
                ApplicationStatus.REVIEWING, 5L,
                ApplicationStatus.INTERVIEW, 3L,
                ApplicationStatus.OFFER, 2L,
                ApplicationStatus.HIRED, 1L
            ),
            Map.of(
                LocalDate.of(2026, 8, 25), 3L,
                LocalDate.of(2026, 8, 26), 4L
            )
        );
    }

    private Map<ApplicationStatus, Long> zeroStatusCounts() {
        Map<ApplicationStatus, Long> counts = new LinkedHashMap<>();
        for (ApplicationStatus status : ApplicationStatus.values()) {
            counts.put(status, 0L);
        }
        return counts;
    }

    private Map<ApplicationSource, Long> zeroSourceCounts() {
        Map<ApplicationSource, Long> counts = new EnumMap<>(
            ApplicationSource.class
        );
        for (ApplicationSource source : ApplicationSource.values()) {
            counts.put(source, 0L);
        }
        return counts;
    }

    private void assertBusinessError(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
        String code,
        HttpStatus status
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code()).isEqualTo(code);
                assertThat(businessError.status()).isEqualTo(status);
            });
    }
}
