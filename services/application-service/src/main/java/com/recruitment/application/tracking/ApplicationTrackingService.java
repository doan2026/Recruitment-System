package com.recruitment.application.tracking;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.domain.ApplicationEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ApplicationTrackingService {
    private final ApplicationTrackingRepository applications;
    private final ApplicationTimelineRepository history;
    private final CompanyClient companies;

    public ApplicationTrackingService(
        ApplicationTrackingRepository applications,
        ApplicationTimelineRepository history,
        CompanyClient companies
    ) {
        this.applications = applications;
        this.history = history;
        this.companies = companies;
    }

    @Transactional(readOnly = true)
    public List<ApplicationListItemResponse> listMine(UUID candidateId) {
        return applications
            .findAllByCandidateIdOrderByAppliedAtDesc(candidateId)
            .stream()
            .map(ApplicationListItemResponse::from)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApplicationDetailResponse getDetail(
        UUID applicationId,
        UUID viewerId,
        TrackingViewerRole viewerRole,
        String authorization
    ) {
        ApplicationEntity application = applications.findById(applicationId)
            .orElseThrow(() -> new BusinessException(
                "APPLICATION_NOT_FOUND",
                "Application was not found",
                HttpStatus.NOT_FOUND
            ));
        authorize(application, viewerId, viewerRole, authorization);
        return ApplicationDetailResponse.from(
            application,
            history.findTimeline(applicationId)
        );
    }

    private void authorize(
        ApplicationEntity application,
        UUID viewerId,
        TrackingViewerRole viewerRole,
        String authorization
    ) {
        if (viewerRole == TrackingViewerRole.CANDIDATE) {
            if (!application.getCandidateId().equals(viewerId)) {
                throw denied();
            }
            return;
        }

        UUID recruiterCompanyId = companies.getRecruiterCompanyId(
            viewerId,
            authorization
        );
        if (!application.getCompanyId().equals(recruiterCompanyId)) {
            throw denied();
        }
    }

    private BusinessException denied() {
        return new BusinessException(
            "APPLICATION_ACCESS_DENIED",
            "You cannot view this application",
            HttpStatus.FORBIDDEN
        );
    }
}
