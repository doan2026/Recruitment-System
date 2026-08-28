package com.recruitment.application.matching;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.AiClient;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.repository.ApplicationRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

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
@Import({
    ApplicationMatchService.class,
    ApplicationMatchScoreWriter.class
})
class ApplicationMatchPostgresIT {
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000002"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID JOB_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final UUID CV_ID = UUID.fromString(
        "40000000-0000-0000-0000-000000000001"
    );
    private static final String AUTHORIZATION =
        "Bearer matching-integration";
    private static final Instant APPLIED_AT = Instant.parse(
        "2026-08-25T08:00:00Z"
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
    private ApplicationMatchService matching;

    @Autowired
    private ApplicationMatchScoreWriter writer;

    @Autowired
    private ApplicationRepository applications;

    @Autowired
    private JdbcTemplate jdbc;

    @MockBean
    private CompanyClient companies;

    @MockBean
    private AiClient ai;

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
                application.cv_submission_gates,
                application.applications
            CASCADE
            """
        );
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
    }

    @Test
    void refreshStoresAndThenReplacesScoreWithoutWorkflowSideEffects() {
        UUID applicationId = saveApplication(COMPANY_ID);
        when(ai.getMatchScore(CV_ID, JOB_ID))
            .thenReturn(
                new BigDecimal("85.46"),
                new BigDecimal("91.25")
            );

        ApplicationMatchScoreResponse first = matching.refresh(
            applicationId,
            RECRUITER_ID,
            AUTHORIZATION,
            new RefreshMatchScoreRequest(0L)
        );
        ApplicationMatchScoreResponse second = matching.refresh(
            applicationId,
            RECRUITER_ID,
            AUTHORIZATION,
            new RefreshMatchScoreRequest(1L)
        );

        ApplicationEntity stored = applications.findById(applicationId)
            .orElseThrow();
        assertThat(first.matchScore()).isEqualByComparingTo("85.46");
        assertThat(first.version()).isEqualTo(1L);
        assertThat(second.matchScore()).isEqualByComparingTo("91.25");
        assertThat(second.version()).isEqualTo(2L);
        assertThat(stored.getMatchScore()).isEqualByComparingTo("91.25");
        assertThat(stored.getVersion()).isEqualTo(2L);
        assertThat(stored.getUpdatedAt()).isEqualTo(APPLIED_AT);
        assertThat(rowCount("application.application_history")).isZero();
        assertThat(rowCount("application.application_event_outbox")).isZero();
    }

    @Test
    void staleExpectedVersionNeverCallsAiOrChangesStoredScore() {
        UUID applicationId = saveApplication(COMPANY_ID);

        assertBusinessError(
            () -> matching.refresh(
                applicationId,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(1L)
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verify(ai, never()).getMatchScore(CV_ID, JOB_ID);
        ApplicationEntity stored = applications.findById(applicationId)
            .orElseThrow();
        assertThat(stored.getMatchScore()).isNull();
        assertThat(stored.getVersion()).isZero();
    }

    @Test
    void recruiterFromAnotherCompanyIsDeniedBeforeAiCall() {
        UUID applicationId = saveApplication(COMPANY_ID);
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            OTHER_COMPANY_ID,
            CompanyMemberRole.OWNER
        ));

        assertBusinessError(
            () -> matching.refresh(
                applicationId,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(0L)
            ),
            "APPLICATION_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );

        verify(ai, never()).getMatchScore(CV_ID, JOB_ID);
        assertThat(applications.findById(applicationId)
            .orElseThrow()
            .getMatchScore()).isNull();
    }

    @Test
    void aiFailurePreservesThePreviousScoreAndVersion() {
        UUID applicationId = saveApplication(COMPANY_ID);
        when(ai.getMatchScore(CV_ID, JOB_ID))
            .thenReturn(new BigDecimal("75.00"))
            .thenThrow(new BusinessException(
                "AI_SERVICE_UNAVAILABLE",
                "Cannot calculate the application match score",
                HttpStatus.SERVICE_UNAVAILABLE
            ));

        matching.refresh(
            applicationId,
            RECRUITER_ID,
            AUTHORIZATION,
            new RefreshMatchScoreRequest(0L)
        );
        assertBusinessError(
            () -> matching.refresh(
                applicationId,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(1L)
            ),
            "AI_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );

        ApplicationEntity stored = applications.findById(applicationId)
            .orElseThrow();
        assertThat(stored.getMatchScore()).isEqualByComparingTo("75.00");
        assertThat(stored.getVersion()).isEqualTo(1L);
    }

    @Test
    void atomicWriterRejectsASecondWriteUsingTheSameVersion() {
        UUID applicationId = saveApplication(COMPANY_ID);

        writer.update(applicationId, new BigDecimal("60.00"), 0L);
        assertBusinessError(
            () -> writer.update(
                applicationId,
                new BigDecimal("90.00"),
                0L
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        ApplicationEntity stored = applications.findById(applicationId)
            .orElseThrow();
        assertThat(stored.getMatchScore()).isEqualByComparingTo("60.00");
        assertThat(stored.getVersion()).isEqualTo(1L);
    }

    @Test
    void databaseConstraintRejectsScoreOutsidePercentRange() {
        UUID applicationId = saveApplication(COMPANY_ID);

        assertThatThrownBy(() -> writer.update(
            applicationId,
            new BigDecimal("100.01"),
            0L
        )).isInstanceOf(DataIntegrityViolationException.class);

        ApplicationEntity stored = applications.findById(applicationId)
            .orElseThrow();
        assertThat(stored.getMatchScore()).isNull();
        assertThat(stored.getVersion()).isZero();
    }

    private UUID saveApplication(UUID companyId) {
        UUID applicationId = UUID.randomUUID();
        applications.saveAndFlush(ApplicationEntity.applied(
            applicationId,
            JOB_ID,
            companyId,
            UUID.randomUUID(),
            RECRUITER_ID,
            CV_ID,
            "Backend Engineer",
            null,
            ApplicationSource.SEARCH,
            APPLIED_AT
        ));
        return applicationId;
    }

    private long rowCount(String table) {
        Long count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM " + table,
            Long.class
        );
        return count == null ? 0L : count;
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
