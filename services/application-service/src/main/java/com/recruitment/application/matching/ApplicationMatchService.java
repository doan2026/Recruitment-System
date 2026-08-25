package com.recruitment.application.matching;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.AiClient;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.repository.ApplicationRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class ApplicationMatchService {
    private final ApplicationRepository applications;
    private final CompanyClient companies;
    private final AiClient ai;
    private final ApplicationMatchScoreWriter writer;

    public ApplicationMatchService(
        ApplicationRepository applications,
        CompanyClient companies,
        AiClient ai,
        ApplicationMatchScoreWriter writer
    ) {
        this.applications = applications;
        this.companies = companies;
        this.ai = ai;
        this.writer = writer;
    }

    public ApplicationMatchScoreResponse refresh(
        UUID applicationId,
        UUID recruiterId,
        String authorization,
        RefreshMatchScoreRequest request
    ) {
        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow(this::notFound);
        authorize(application, recruiterId, authorization);
        long expectedVersion = request.expectedVersion();
        if (application.getVersion() != expectedVersion) {
            throw concurrentChange();
        }

        BigDecimal score = ai.getMatchScore(
            application.getCvId(),
            application.getJobId()
        );
        return writer.update(applicationId, score, expectedVersion);
    }

    private void authorize(
        ApplicationEntity application,
        UUID recruiterId,
        String authorization
    ) {
        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(recruiterId, authorization);
        if (
            !membership.canManageAllCompanyApplications() ||
            !application.getCompanyId().equals(membership.companyId())
        ) {
            throw denied();
        }
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
            "You cannot refresh this application's match score",
            HttpStatus.FORBIDDEN
        );
    }

    private BusinessException concurrentChange() {
        return new BusinessException(
            "APPLICATION_CHANGED_CONCURRENTLY",
            "Application changed concurrently; reload and try again",
            HttpStatus.CONFLICT
        );
    }
}
