package com.recruitment.application.evaluation;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.EvaluationEntity;
import com.recruitment.application.repository.ApplicationRepository;
import com.recruitment.application.repository.EvaluationRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ApplicationEvaluationService {
    private static final String EVALUATION_UNIQUE_CONSTRAINT =
        "evaluations_application_evaluator_unique";
    private static final int MAX_CRITERIA = 20;
    private static final int MAX_CRITERIA_NAME_LENGTH = 100;
    private static final int MAX_NOTE_LENGTH = 2000;
    private static final BigDecimal MIN_SCORE = BigDecimal.ZERO;
    private static final BigDecimal MAX_SCORE = BigDecimal.valueOf(100);

    private final ApplicationRepository applications;
    private final EvaluationRepository evaluations;
    private final CompanyClient companies;
    private final Clock clock;

    @Autowired
    public ApplicationEvaluationService(
        ApplicationRepository applications,
        EvaluationRepository evaluations,
        CompanyClient companies
    ) {
        this(applications, evaluations, companies, Clock.systemUTC());
    }

    ApplicationEvaluationService(
        ApplicationRepository applications,
        EvaluationRepository evaluations,
        CompanyClient companies,
        Clock clock
    ) {
        this.applications = applications;
        this.evaluations = evaluations;
        this.companies = companies;
        this.clock = clock;
    }

    @Transactional
    public EvaluationResponse create(
        UUID applicationId,
        UUID evaluatorId,
        String authorization,
        CreateEvaluationRequest request
    ) {
        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow(this::notFound);
        authorize(application, evaluatorId, authorization);

        BigDecimal score = normalizeScore(request.score(), "score");
        Map<String, BigDecimal> criteria =
            normalizeCriteria(request.criteria());
        String note = normalizeNote(request.note());

        if (evaluations.existsByApplicationIdAndEvaluatorId(
            applicationId,
            evaluatorId
        )) {
            throw duplicate();
        }

        EvaluationEntity evaluation = EvaluationEntity.create(
            UUID.randomUUID(),
            applicationId,
            evaluatorId,
            score,
            criteria,
            note,
            clock.instant()
        );
        try {
            evaluations.saveAndFlush(evaluation);
        } catch (DataIntegrityViolationException exception) {
            if (violatesEvaluationUniqueConstraint(exception)) {
                throw duplicate();
            }
            throw exception;
        }
        return EvaluationResponse.from(evaluation);
    }

    private boolean violatesEvaluationUniqueConstraint(Throwable exception) {
        Throwable cause = exception;
        while (cause != null) {
            if (
                cause instanceof ConstraintViolationException violation &&
                EVALUATION_UNIQUE_CONSTRAINT.equals(
                    violation.getConstraintName()
                )
            ) {
                return true;
            }
            Throwable next = cause.getCause();
            cause = next == cause ? null : next;
        }
        return false;
    }

    private void authorize(
        ApplicationEntity application,
        UUID evaluatorId,
        String authorization
    ) {
        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(evaluatorId, authorization);
        if (
            !membership.canManageAllCompanyApplications() ||
            !application.getCompanyId().equals(membership.companyId())
        ) {
            throw denied();
        }
    }

    private BigDecimal normalizeScore(BigDecimal score, String field) {
        if (
            score == null ||
            score.compareTo(MIN_SCORE) < 0 ||
            score.compareTo(MAX_SCORE) > 0
        ) {
            throw invalidScore(field);
        }
        try {
            return score.setScale(2, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException exception) {
            throw invalidScore(field);
        }
    }

    private Map<String, BigDecimal> normalizeCriteria(
        Map<String, BigDecimal> criteria
    ) {
        if (
            criteria == null ||
            criteria.isEmpty() ||
            criteria.size() > MAX_CRITERIA
        ) {
            throw invalidCriteria();
        }

        Map<String, BigDecimal> normalized = new LinkedHashMap<>();
        criteria.forEach((rawName, rawScore) -> {
            String name = rawName == null ? null : rawName.strip();
            if (
                name == null ||
                name.isEmpty() ||
                name.length() > MAX_CRITERIA_NAME_LENGTH ||
                normalized.containsKey(name)
            ) {
                throw invalidCriteria();
            }
            normalized.put(
                name,
                normalizeScore(rawScore, "criteria." + name)
            );
        });
        return normalized;
    }

    private String normalizeNote(String note) {
        if (note == null) {
            return null;
        }
        String normalized = note.strip();
        if (normalized.isEmpty()) {
            return null;
        }
        if (normalized.length() > MAX_NOTE_LENGTH) {
            throw new BusinessException(
                "INVALID_EVALUATION_NOTE",
                "Evaluation note must not exceed 2000 characters",
                HttpStatus.BAD_REQUEST
            );
        }
        return normalized;
    }

    private BusinessException invalidScore(String field) {
        return new BusinessException(
            "INVALID_EVALUATION_SCORE",
            "Evaluation scores must be between 0 and 100 with at most " +
                "2 decimal places",
            HttpStatus.BAD_REQUEST,
            Map.of("field", field)
        );
    }

    private BusinessException invalidCriteria() {
        return new BusinessException(
            "INVALID_EVALUATION_CRITERIA",
            "criteria must contain 1 to 20 uniquely named scores",
            HttpStatus.BAD_REQUEST
        );
    }

    private BusinessException notFound() {
        return new BusinessException(
            "APPLICATION_NOT_FOUND",
            "Application was not found",
            HttpStatus.NOT_FOUND
        );
    }

    private BusinessException denied() {
        return new BusinessException(
            "APPLICATION_ACCESS_DENIED",
            "You cannot evaluate this application",
            HttpStatus.FORBIDDEN
        );
    }

    private BusinessException duplicate() {
        return new BusinessException(
            "EVALUATION_ALREADY_EXISTS",
            "This recruiter has already evaluated this application",
            HttpStatus.CONFLICT
        );
    }
}
