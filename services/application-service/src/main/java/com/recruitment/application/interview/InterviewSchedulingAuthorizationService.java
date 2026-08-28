package com.recruitment.application.interview;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.repository.ApplicationRepository;
import java.util.EnumSet;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class InterviewSchedulingAuthorizationService {
    private static final EnumSet<ApplicationStatus> SCHEDULABLE_STATUSES =
        EnumSet.of(ApplicationStatus.REVIEWING, ApplicationStatus.INTERVIEW);

    private final ApplicationRepository applications;
    private final CompanyClient companies;

    public InterviewSchedulingAuthorizationService(
        ApplicationRepository applications,
        CompanyClient companies
    ) {
        this.applications = applications;
        this.companies = companies;
    }

    public InterviewSchedulingContextResponse authorize(
        UUID applicationId,
        UUID recruiterId,
        String authorization
    ) {
        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(recruiterId, authorization);
        ApplicationEntity application = applications
            .findByIdAndCompanyId(applicationId, membership.companyId())
            .orElseThrow(() -> new BusinessException(
                "APPLICATION_NOT_FOUND",
                "Application was not found",
                HttpStatus.NOT_FOUND
            ));
        if (!SCHEDULABLE_STATUSES.contains(application.getStatus())) {
            throw new BusinessException(
                "APPLICATION_NOT_SCHEDULABLE",
                "Application must be in REVIEWING or INTERVIEW status",
                HttpStatus.CONFLICT
            );
        }

        return new InterviewSchedulingContextResponse(
            application.getId(),
            application.getJobId(),
            application.getCompanyId(),
            application.getCandidateId(),
            application.getStatus(),
            application.getVersion()
        );
    }
}
