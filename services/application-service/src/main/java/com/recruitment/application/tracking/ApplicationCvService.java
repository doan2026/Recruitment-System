package com.recruitment.application.tracking;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.ProfileClient;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class ApplicationCvService {
    private final ApplicationTrackingRepository applications;
    private final CompanyClient companies;
    private final ProfileClient profiles;

    public ApplicationCvService(
        ApplicationTrackingRepository applications,
        CompanyClient companies,
        ProfileClient profiles
    ) {
        this.applications = applications;
        this.companies = companies;
        this.profiles = profiles;
    }

    public ApplicationCvResponse getCv(
        UUID applicationId,
        UUID recruiterId,
        String authorization
    ) {
        ApplicationEntity application = findAuthorized(
            applicationId,
            recruiterId,
            authorization
        );
        return ApplicationCvResponse.from(profiles.getCandidateCv(
            application.getCandidateId(),
            application.getCvId()
        ));
    }

    public ApplicationCvDownloadResponse createDownloadUrl(
        UUID applicationId,
        UUID recruiterId,
        String authorization
    ) {
        ApplicationEntity application = findAuthorized(
            applicationId,
            recruiterId,
            authorization
        );
        return ApplicationCvDownloadResponse.from(
            profiles.createCandidateCvDownloadUrl(
                application.getCandidateId(),
                application.getCvId()
            )
        );
    }

    private ApplicationEntity findAuthorized(
        UUID applicationId,
        UUID recruiterId,
        String authorization
    ) {
        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(recruiterId, authorization);
        if (!membership.canManageAllCompanyApplications()) {
            throw denied();
        }
        return applications
            .findByIdAndCompanyId(applicationId, membership.companyId())
            .orElseThrow(this::notFound);
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
            "You cannot view this application's CV",
            HttpStatus.FORBIDDEN
        );
    }
}
