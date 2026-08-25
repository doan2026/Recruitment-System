package com.recruitment.application.tracking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
import com.recruitment.application.domain.ApplicationStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class ApplicationTrackingServiceTest {
    private static final Instant APPLIED_AT =
        Instant.parse("2026-08-24T08:00:00Z");

    private final ApplicationTrackingRepository applications =
        mock(ApplicationTrackingRepository.class);
    private final ApplicationTimelineRepository history =
        mock(ApplicationTimelineRepository.class);
    private final CompanyClient companies = mock(CompanyClient.class);
    private ApplicationTrackingService service;

    private final UUID applicationId = UUID.randomUUID();
    private final UUID candidateId = UUID.randomUUID();
    private final UUID recruiterId = UUID.randomUUID();
    private final UUID companyId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private final ApplicationEntity application = ApplicationEntity.applied(
        applicationId,
        jobId,
        companyId,
        candidateId,
        recruiterId,
        UUID.randomUUID(),
        "Backend Engineer",
        "Hello HR",
        ApplicationSource.SEARCH,
        APPLIED_AT
    );

    @BeforeEach
    void setUp() {
        service = new ApplicationTrackingService(
            applications,
            history,
            companies
        );
    }

    @Test
    void candidateListContainsOnlyRepositoryScopedApplications() {
        when(applications.findAllByCandidateIdOrderByAppliedAtDesc(candidateId))
            .thenReturn(List.of(application));

        List<ApplicationListItemResponse> result = service.listMine(candidateId);

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().id()).isEqualTo(applicationId);
        assertThat(result.getFirst().jobTitle())
            .isEqualTo("Backend Engineer");
        verify(applications)
            .findAllByCandidateIdOrderByAppliedAtDesc(candidateId);
    }

    @Test
    void ownerCandidateCanViewDetailAndTimeline() {
        TimelineEntryResponse entry = new TimelineEntryResponse(
            null,
            ApplicationStatus.APPLIED,
            null,
            APPLIED_AT
        );
        when(applications.findById(applicationId))
            .thenReturn(Optional.of(application));
        when(history.findTimeline(applicationId)).thenReturn(List.of(entry));

        ApplicationDetailResponse result = service.getDetail(
            applicationId,
            candidateId,
            TrackingViewerRole.CANDIDATE,
            "Bearer token"
        );

        assertThat(result.candidateId()).isEqualTo(candidateId);
        assertThat(result.timeline()).containsExactly(entry);
        verify(companies, never()).getRecruiterMembership(
            candidateId,
            "Bearer token"
        );
    }

    @Test
    void anotherCandidateCannotViewDetail() {
        when(applications.findById(applicationId))
            .thenReturn(Optional.of(application));

        assertThatThrownBy(() -> service.getDetail(
            applicationId,
            UUID.randomUUID(),
            TrackingViewerRole.CANDIDATE,
            "Bearer token"
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_ACCESS_DENIED");
        verify(history, never()).findTimeline(applicationId);
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void companyMemberRolesCanViewDetailAcrossCompanyJobs(
        CompanyMemberRole role
    ) {
        UUID viewerId = UUID.randomUUID();
        when(applications.findById(applicationId))
            .thenReturn(Optional.of(application));
        when(companies.getRecruiterMembership(viewerId, "Bearer token"))
            .thenReturn(new RecruiterCompanyMembership(companyId, role));
        when(history.findTimeline(applicationId)).thenReturn(List.of());

        ApplicationDetailResponse result = service.getDetail(
            applicationId,
            viewerId,
            TrackingViewerRole.RECRUITER,
            "Bearer token"
        );

        assertThat(result.companyId()).isEqualTo(companyId);
        assertThat(application.getRecruiterId()).isNotEqualTo(viewerId);
    }

    @Test
    void recruiterFromAnotherCompanyCannotViewDetail() {
        UUID viewerId = UUID.randomUUID();
        when(applications.findById(applicationId))
            .thenReturn(Optional.of(application));
        when(companies.getRecruiterMembership(viewerId, "Bearer token"))
            .thenReturn(new RecruiterCompanyMembership(
                UUID.randomUUID(),
                CompanyMemberRole.MEMBER
            ));

        assertThatThrownBy(() -> service.getDetail(
            applicationId,
            viewerId,
            TrackingViewerRole.RECRUITER,
            "Bearer token"
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_ACCESS_DENIED");
        verify(history, never()).findTimeline(applicationId);
    }

    @Test
    void missingApplicationReturnsNotFound() {
        when(applications.findById(applicationId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDetail(
            applicationId,
            candidateId,
            TrackingViewerRole.CANDIDATE,
            "Bearer token"
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_NOT_FOUND");
    }
}
