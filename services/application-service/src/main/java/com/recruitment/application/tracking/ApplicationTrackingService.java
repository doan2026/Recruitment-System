package com.recruitment.application.tracking;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.OfferEntity;
import com.recruitment.application.repository.OfferRepository;
import java.util.Map;
import java.util.stream.Collectors;
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
    private final OfferRepository offers;

    public ApplicationTrackingService(
        ApplicationTrackingRepository applications,
        ApplicationTimelineRepository history,
        CompanyClient companies,
        OfferRepository offers
    ) {
        this.applications = applications;
        this.history = history;
        this.companies = companies;
        this.offers = offers;
    }

    @Transactional(readOnly = true)
    public List<ApplicationListItemResponse> listMine(UUID candidateId) {
        List<ApplicationEntity> mine =
            applications.findAllByCandidateIdOrderByAppliedAtDesc(candidateId);
        if (mine.isEmpty()) return List.of();
        Map<UUID, UUID> offerIds = offers.findReferencesByApplicationIdIn(
            mine.stream().map(ApplicationEntity::getId).toList()
        ).stream().collect(Collectors.toMap(
            OfferRepository.OfferReference::getApplicationId,
            OfferRepository.OfferReference::getId
        ));
        return mine.stream()
            .map(application -> ApplicationListItemResponse.from(
                application, offerIds.get(application.getId())
            ))
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
            history.findTimeline(applicationId),
            offers.findByApplicationId(applicationId).map(OfferEntity::getId).orElse(null)
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

        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(viewerId, authorization);
        if (
            !membership.canManageAllCompanyApplications() ||
            !application.getCompanyId().equals(membership.companyId())
        ) {
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
