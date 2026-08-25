package com.recruitment.application.evaluation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.EvaluationEntity;
import com.recruitment.application.repository.ApplicationRepository;
import com.recruitment.application.repository.EvaluationRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
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
@Import(ApplicationEvaluationPostgresIT.TestEvaluationConfiguration.class)
class ApplicationEvaluationPostgresIT {
    private static final UUID COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_COMPANY_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000002"
    );
    private static final UUID EVALUATOR_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID SECOND_EVALUATOR_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000002"
    );
    private static final UUID OUTSIDE_EVALUATOR_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000003"
    );
    private static final Instant CREATED_AT = Instant.parse(
        "2026-08-25T08:30:00Z"
    );
    private static final String AUTHORIZATION =
        "Bearer evaluation-integration";

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
    private ApplicationEvaluationService service;

    @Autowired
    private ApplicationRepository applications;

    @Autowired
    private EvaluationRepository evaluations;

    @Autowired
    private JdbcTemplate jdbc;

    @MockBean
    private CompanyClient companies;

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
                application.applications
            CASCADE
            """
        );
        when(companies.getRecruiterMembership(
            EVALUATOR_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
        when(companies.getRecruiterMembership(
            SECOND_EVALUATOR_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.OWNER
        ));
        when(companies.getRecruiterMembership(
            OUTSIDE_EVALUATOR_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            OTHER_COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
    }

    @Test
    void flywayV3CreatesTheEvaluationJsonbSchema() {
        List<String> appliedVersions = jdbc.queryForList(
            """
            SELECT version
            FROM application.flyway_schema_history
            WHERE success AND version IS NOT NULL
            ORDER BY installed_rank
            """,
            String.class
        );
        String criteriaType = jdbc.queryForObject(
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_schema = 'application'
              AND table_name = 'evaluations'
              AND column_name = 'criteria_json'
            """,
            String.class
        );
        List<String> tables = jdbc.queryForList(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'application'
            ORDER BY table_name
            """,
            String.class
        );

        assertThat(appliedVersions).containsExactly("1", "2", "3", "4", "5");
        assertThat(criteriaType).isEqualTo("jsonb");
        assertThat(tables).contains("evaluations", "offers");
    }

    @Test
    void evaluationRoundTripsJsonbAndStoresEvaluatorTimeAndTrimmedNote() {
        UUID applicationId = saveAppliedApplication(COMPANY_ID);
        Map<String, BigDecimal> criteria = new LinkedHashMap<>();
        criteria.put("  technical  ", new BigDecimal("91.25"));
        criteria.put("communication", new BigDecimal("82.50"));

        EvaluationResponse response = service.create(
            applicationId,
            EVALUATOR_ID,
            AUTHORIZATION,
            new CreateEvaluationRequest(
                new BigDecimal("87.50"),
                criteria,
                "  Strong backend fundamentals  "
            )
        );

        EvaluationEntity stored = evaluations.findById(response.id())
            .orElseThrow();
        Map<String, Object> jsonb = jdbc.queryForMap(
            """
            SELECT jsonb_typeof(criteria_json) AS json_type,
                   criteria_json ->> 'technical' AS technical,
                   criteria_json ->> 'communication' AS communication
            FROM application.evaluations
            WHERE id = ?
            """,
            response.id()
        );

        assertThat(response.applicationId()).isEqualTo(applicationId);
        assertThat(response.evaluatorId()).isEqualTo(EVALUATOR_ID);
        assertThat(response.createdAt()).isEqualTo(CREATED_AT);
        assertThat(response.note()).isEqualTo("Strong backend fundamentals");
        assertThat(response.score()).isEqualByComparingTo("87.50");
        assertThat(response.criteria())
            .containsEntry("technical", new BigDecimal("91.25"))
            .containsEntry("communication", new BigDecimal("82.50"));

        assertThat(stored.getApplicationId()).isEqualTo(applicationId);
        assertThat(stored.getEvaluatorId()).isEqualTo(EVALUATOR_ID);
        assertThat(stored.getCreatedAt()).isEqualTo(CREATED_AT);
        assertThat(stored.getNote()).isEqualTo("Strong backend fundamentals");
        assertThat(stored.getScore()).isEqualByComparingTo("87.50");
        assertThat(stored.getCriteria())
            .containsEntry("technical", new BigDecimal("91.25"))
            .containsEntry("communication", new BigDecimal("82.50"));
        assertThat(jsonb)
            .containsEntry("json_type", "object")
            .containsEntry("technical", "91.25")
            .containsEntry("communication", "82.50");
    }

    @Test
    void sameEvaluatorCannotEvaluateTheApplicationTwice() {
        UUID applicationId = saveAppliedApplication(COMPANY_ID);
        service.create(
            applicationId,
            EVALUATOR_ID,
            AUTHORIZATION,
            request("First evaluation")
        );

        assertThatThrownBy(() -> service.create(
            applicationId,
            EVALUATOR_ID,
            AUTHORIZATION,
            request("Duplicate evaluation")
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code())
                    .isEqualTo("EVALUATION_ALREADY_EXISTS");
                assertThat(businessError.status())
                    .isEqualTo(HttpStatus.CONFLICT);
            });
        assertThat(evaluations.count()).isEqualTo(1L);
    }

    @Test
    void databaseUniqueConstraintRejectsConcurrentPrecheckRace() {
        UUID applicationId = saveAppliedApplication(COMPANY_ID);
        evaluations.saveAndFlush(directEvaluation(
            applicationId,
            EVALUATOR_ID,
            "First direct insert"
        ));

        DataIntegrityViolationException failure = catchThrowableOfType(
            () -> evaluations.saveAndFlush(directEvaluation(
                applicationId,
                EVALUATOR_ID,
                "Duplicate direct insert"
            )),
            DataIntegrityViolationException.class
        );

        assertThat(failure).isNotNull();
        ConstraintViolationException constraint = findConstraintViolation(
            failure
        );
        assertThat(constraint).isNotNull();
        assertThat(constraint.getConstraintName())
            .isEqualTo("evaluations_application_evaluator_unique");
        assertThat(evaluations.count()).isEqualTo(1L);
    }

    @Test
    void differentEvaluatorsCanEvaluateTheSameApplication() {
        UUID applicationId = saveAppliedApplication(COMPANY_ID);

        service.create(
            applicationId,
            EVALUATOR_ID,
            AUTHORIZATION,
            request("Member evaluation")
        );
        service.create(
            applicationId,
            SECOND_EVALUATOR_ID,
            AUTHORIZATION,
            request("Owner evaluation")
        );

        assertThat(evaluations.findAll())
            .extracting(EvaluationEntity::getEvaluatorId)
            .containsExactlyInAnyOrder(EVALUATOR_ID, SECOND_EVALUATOR_ID);
    }

    @Test
    void recruiterFromAnotherCompanyCannotCreateAnEvaluation() {
        UUID applicationId = saveAppliedApplication(COMPANY_ID);

        assertThatThrownBy(() -> service.create(
            applicationId,
            OUTSIDE_EVALUATOR_ID,
            AUTHORIZATION,
            request("Unauthorized evaluation")
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code())
                    .isEqualTo("APPLICATION_ACCESS_DENIED");
                assertThat(businessError.status())
                    .isEqualTo(HttpStatus.FORBIDDEN);
            });
        assertThat(evaluations.count()).isZero();
    }

    @Test
    void deletingAnApplicationCascadesItsEvaluations() {
        UUID applicationId = saveAppliedApplication(COMPANY_ID);
        service.create(
            applicationId,
            EVALUATOR_ID,
            AUTHORIZATION,
            request("Evaluation removed with application")
        );
        assertThat(evaluations.count()).isEqualTo(1L);

        applications.deleteById(applicationId);

        assertThat(applications.findById(applicationId)).isEmpty();
        assertThat(evaluations.count()).isZero();
    }

    private CreateEvaluationRequest request(String note) {
        return new CreateEvaluationRequest(
            new BigDecimal("85.00"),
            Map.of(
                "technical", new BigDecimal("90.00"),
                "communication", new BigDecimal("80.00")
            ),
            note
        );
    }

    private EvaluationEntity directEvaluation(
        UUID applicationId,
        UUID evaluatorId,
        String note
    ) {
        return EvaluationEntity.create(
            UUID.randomUUID(),
            applicationId,
            evaluatorId,
            new BigDecimal("85.00"),
            Map.of("technical", new BigDecimal("90.00")),
            note,
            CREATED_AT
        );
    }

    private ConstraintViolationException findConstraintViolation(
        Throwable exception
    ) {
        Throwable cause = exception;
        while (cause != null) {
            if (cause instanceof ConstraintViolationException violation) {
                return violation;
            }
            Throwable next = cause.getCause();
            cause = next == cause ? null : next;
        }
        return null;
    }

    private UUID saveAppliedApplication(UUID companyId) {
        UUID applicationId = UUID.randomUUID();
        applications.saveAndFlush(ApplicationEntity.applied(
            applicationId,
            UUID.randomUUID(),
            companyId,
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Backend Engineer",
            "Evaluation integration candidate",
            ApplicationSource.SEARCH,
            Instant.parse("2026-08-24T00:00:00Z")
        ));
        return applicationId;
    }

    @TestConfiguration
    static class TestEvaluationConfiguration {
        @Bean
        ApplicationEvaluationService applicationEvaluationService(
            ApplicationRepository applications,
            EvaluationRepository evaluations,
            CompanyClient companies
        ) {
            return new ApplicationEvaluationService(
                applications,
                evaluations,
                companies,
                Clock.fixed(CREATED_AT, ZoneOffset.UTC)
            );
        }
    }
}
