package com.recruitment.application.evaluation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.hibernate.exception.ConstraintViolationException;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;

class ApplicationEvaluationServiceTest {
    private static final Instant NOW =
        Instant.parse("2026-08-25T08:00:00Z");
    private static final String AUTHORIZATION = "Bearer token";

    private final ApplicationRepository applications =
        mock(ApplicationRepository.class);
    private final EvaluationRepository evaluations =
        mock(EvaluationRepository.class);
    private final CompanyClient companies = mock(CompanyClient.class);

    private final UUID applicationId = UUID.randomUUID();
    private final UUID companyId = UUID.randomUUID();
    private final UUID evaluatorId = UUID.randomUUID();
    private final UUID jobOwnerId = UUID.randomUUID();
    private final ApplicationEntity application = ApplicationEntity.applied(
        applicationId,
        UUID.randomUUID(),
        companyId,
        UUID.randomUUID(),
        jobOwnerId,
        UUID.randomUUID(),
        "Backend Engineer",
        null,
        ApplicationSource.SEARCH,
        NOW.minusSeconds(3600)
    );

    private ApplicationEvaluationService service;

    @BeforeEach
    void setUp() {
        service = new ApplicationEvaluationService(
            applications,
            evaluations,
            companies,
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
        when(applications.findById(applicationId))
            .thenReturn(Optional.of(application));
        when(companies.getRecruiterMembership(evaluatorId, AUTHORIZATION))
            .thenReturn(new RecruiterCompanyMembership(
                companyId,
                CompanyMemberRole.MEMBER
            ));
        when(evaluations.existsByApplicationIdAndEvaluatorId(
            applicationId,
            evaluatorId
        )).thenReturn(false);
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void memberAndOwnerCanEvaluateAnyApplicationInTheirCompany(
        CompanyMemberRole role
    ) {
        when(companies.getRecruiterMembership(evaluatorId, AUTHORIZATION))
            .thenReturn(new RecruiterCompanyMembership(companyId, role));

        EvaluationResponse response = service.create(
            applicationId,
            evaluatorId,
            AUTHORIZATION,
            validRequest()
        );

        assertThat(response.applicationId()).isEqualTo(applicationId);
        assertThat(response.evaluatorId())
            .isEqualTo(evaluatorId)
            .isNotEqualTo(jobOwnerId);
        assertThat(response.score()).isEqualByComparingTo("85.50");
        assertThat(response.criteria())
            .containsEntry("technical", new BigDecimal("90.00"))
            .containsEntry("communication", new BigDecimal("80.00"));
        assertThat(response.note()).isEqualTo("Strong fit");
        assertThat(response.createdAt()).isEqualTo(NOW);

        ArgumentCaptor<EvaluationEntity> saved =
            ArgumentCaptor.forClass(EvaluationEntity.class);
        verify(evaluations).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getEvaluatorId()).isEqualTo(evaluatorId);
        assertThat(saved.getValue().getCreatedAt()).isEqualTo(NOW);
    }

    @Test
    void recruiterFromAnotherCompanyCannotEvaluateApplication() {
        when(companies.getRecruiterMembership(evaluatorId, AUTHORIZATION))
            .thenReturn(new RecruiterCompanyMembership(
                UUID.randomUUID(),
                CompanyMemberRole.OWNER
            ));

        assertBusinessException(
            () -> service.create(
                applicationId,
                evaluatorId,
                AUTHORIZATION,
                validRequest()
            ),
            "APPLICATION_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );

        verify(evaluations, never())
            .existsByApplicationIdAndEvaluatorId(any(), any());
        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void missingApplicationReturnsNotFoundBeforeMembershipLookup() {
        when(applications.findById(applicationId)).thenReturn(Optional.empty());

        assertBusinessException(
            () -> service.create(
                applicationId,
                evaluatorId,
                AUTHORIZATION,
                validRequest()
            ),
            "APPLICATION_NOT_FOUND",
            HttpStatus.NOT_FOUND
        );

        verify(companies, never()).getRecruiterMembership(any(), any());
        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void duplicatePrecheckReturnsConflictWithoutSaving() {
        when(evaluations.existsByApplicationIdAndEvaluatorId(
            applicationId,
            evaluatorId
        )).thenReturn(true);

        assertBusinessException(
            () -> service.create(
                applicationId,
                evaluatorId,
                AUTHORIZATION,
                validRequest()
            ),
            "EVALUATION_ALREADY_EXISTS",
            HttpStatus.CONFLICT
        );

        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void databaseUniqueConstraintRaceReturnsConflict() {
        when(evaluations.saveAndFlush(any(EvaluationEntity.class)))
            .thenThrow(databaseConstraintViolation(
                "evaluations_application_evaluator_unique"
            ));

        assertBusinessException(
            () -> service.create(
                applicationId,
                evaluatorId,
                AUTHORIZATION,
                validRequest()
            ),
            "EVALUATION_ALREADY_EXISTS",
            HttpStatus.CONFLICT
        );
    }

    @Test
    void otherDatabaseConstraintViolationIsPropagated() {
        DataIntegrityViolationException integrityFailure =
            databaseConstraintViolation("evaluations_score_check");
        when(evaluations.saveAndFlush(any(EvaluationEntity.class)))
            .thenThrow(integrityFailure);

        assertThatThrownBy(() -> service.create(
            applicationId,
            evaluatorId,
            AUTHORIZATION,
            validRequest()
        )).isSameAs(integrityFailure);
    }

    @Test
    void rejectsInvalidOverallScores() {
        for (BigDecimal score : Arrays.asList(
            null,
            new BigDecimal("-0.01"),
            new BigDecimal("100.01"),
            new BigDecimal("85.001")
        )) {
            BusinessException exception = assertBusinessException(
                () -> service.create(
                    applicationId,
                    evaluatorId,
                    AUTHORIZATION,
                    new CreateEvaluationRequest(
                        score,
                        validCriteria(),
                        "Strong fit"
                    )
                ),
                "INVALID_EVALUATION_SCORE",
                HttpStatus.BAD_REQUEST
            );
            assertThat(exception.details()).containsEntry("field", "score");
        }

        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void rejectsMissingEmptyAndOversizedCriteria() {
        LinkedHashMap<String, BigDecimal> oversized = new LinkedHashMap<>();
        for (int index = 0; index < 21; index++) {
            oversized.put("criterion-" + index, BigDecimal.TEN);
        }

        for (Map<String, BigDecimal> criteria :
            Arrays.<Map<String, BigDecimal>>asList(
                null,
                Map.of(),
                oversized
            )) {
            assertBusinessException(
                () -> service.create(
                    applicationId,
                    evaluatorId,
                    AUTHORIZATION,
                    new CreateEvaluationRequest(
                        new BigDecimal("85"),
                        criteria,
                        "Strong fit"
                    )
                ),
                "INVALID_EVALUATION_CRITERIA",
                HttpStatus.BAD_REQUEST
            );
        }

        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void rejectsInvalidAndDuplicateNormalizedCriteriaNames() {
        LinkedHashMap<String, BigDecimal> nullName = new LinkedHashMap<>();
        nullName.put(null, BigDecimal.TEN);
        LinkedHashMap<String, BigDecimal> duplicateName =
            new LinkedHashMap<>();
        duplicateName.put("technical", BigDecimal.TEN);
        duplicateName.put(" technical ", BigDecimal.ONE);

        for (Map<String, BigDecimal> criteria : Arrays.asList(
            Map.of("   ", BigDecimal.TEN),
            Map.of("x".repeat(101), BigDecimal.TEN),
            nullName,
            duplicateName
        )) {
            assertBusinessException(
                () -> service.create(
                    applicationId,
                    evaluatorId,
                    AUTHORIZATION,
                    new CreateEvaluationRequest(
                        new BigDecimal("85"),
                        criteria,
                        "Strong fit"
                    )
                ),
                "INVALID_EVALUATION_CRITERIA",
                HttpStatus.BAD_REQUEST
            );
        }

        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void rejectsInvalidCriterionScoresWithFieldDetails() {
        for (BigDecimal score : Arrays.asList(
            null,
            new BigDecimal("-0.01"),
            new BigDecimal("100.01"),
            new BigDecimal("75.001")
        )) {
            LinkedHashMap<String, BigDecimal> criteria =
                new LinkedHashMap<>();
            criteria.put("technical", score);

            BusinessException exception = assertBusinessException(
                () -> service.create(
                    applicationId,
                    evaluatorId,
                    AUTHORIZATION,
                    new CreateEvaluationRequest(
                        new BigDecimal("85"),
                        criteria,
                        "Strong fit"
                    )
                ),
                "INVALID_EVALUATION_SCORE",
                HttpStatus.BAD_REQUEST
            );
            assertThat(exception.details())
                .containsEntry("field", "criteria.technical");
        }

        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void rejectsNoteLongerThanTwoThousandCharacters() {
        assertBusinessException(
            () -> service.create(
                applicationId,
                evaluatorId,
                AUTHORIZATION,
                new CreateEvaluationRequest(
                    new BigDecimal("85"),
                    validCriteria(),
                    "x".repeat(2001)
                )
            ),
            "INVALID_EVALUATION_NOTE",
            HttpStatus.BAD_REQUEST
        );

        verify(evaluations, never()).saveAndFlush(any());
    }

    @Test
    void blankNoteIsNormalizedToNull() {
        EvaluationResponse response = service.create(
            applicationId,
            evaluatorId,
            AUTHORIZATION,
            new CreateEvaluationRequest(
                new BigDecimal("85"),
                validCriteria(),
                "  \n  "
            )
        );

        assertThat(response.note()).isNull();
        ArgumentCaptor<EvaluationEntity> saved =
            ArgumentCaptor.forClass(EvaluationEntity.class);
        verify(evaluations).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getNote()).isNull();
    }

    @Test
    void companyServiceUnavailableErrorIsPropagated() {
        BusinessException unavailable = new BusinessException(
            "COMPANY_SERVICE_UNAVAILABLE",
            "Cannot verify recruiter company membership",
            HttpStatus.SERVICE_UNAVAILABLE
        );
        when(companies.getRecruiterMembership(evaluatorId, AUTHORIZATION))
            .thenThrow(unavailable);

        BusinessException thrown = assertBusinessException(
            () -> service.create(
                applicationId,
                evaluatorId,
                AUTHORIZATION,
                validRequest()
            ),
            "COMPANY_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );

        assertThat(thrown).isSameAs(unavailable);
        verify(evaluations, never())
            .existsByApplicationIdAndEvaluatorId(any(), any());
        verify(evaluations, never()).saveAndFlush(any());
    }

    private CreateEvaluationRequest validRequest() {
        return new CreateEvaluationRequest(
            new BigDecimal("85.5"),
            Map.of(
                " technical ",
                new BigDecimal("90"),
                "communication",
                new BigDecimal("80")
            ),
            "  Strong fit  "
        );
    }

    private Map<String, BigDecimal> validCriteria() {
        return Map.of("technical", new BigDecimal("90"));
    }

    private DataIntegrityViolationException databaseConstraintViolation(
        String constraintName
    ) {
        ConstraintViolationException hibernateFailure =
            new ConstraintViolationException(
                "Database constraint violation",
                new SQLException("Constraint violation"),
                "insert into evaluations",
                constraintName
            );
        return new DataIntegrityViolationException(
            "Evaluation insert failed",
            hibernateFailure
        );
    }

    private BusinessException assertBusinessException(
        ThrowingCallable action,
        String code,
        HttpStatus status
    ) {
        BusinessException exception = catchThrowableOfType(
            action,
            BusinessException.class
        );
        assertThat(exception).isNotNull();
        assertThat(exception.code()).isEqualTo(code);
        assertThat(exception.status()).isEqualTo(status);
        return exception;
    }
}
