package com.recruitment.application.pipeline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.domain.OfferEntity;
import com.recruitment.application.domain.OfferStatus;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.OfferRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

class ApplicationPipelineServiceTest {
    private static final Instant NOW =
        Instant.parse("2026-08-24T08:00:00Z");

    private final ApplicationPipelineRepository applications =
        mock(ApplicationPipelineRepository.class);
    private final ApplicationHistoryWriter history =
        mock(ApplicationHistoryWriter.class);
    private final ApplicationEventOutboxRepository outbox =
        mock(ApplicationEventOutboxRepository.class);
    private final OfferRepository offers =
        mock(OfferRepository.class);
    private final CompanyClient companies = mock(CompanyClient.class);
    private ApplicationPipelineService service;

    private final UUID applicationId = UUID.randomUUID();
    private final UUID candidateId = UUID.randomUUID();
    private final UUID recruiterId = UUID.randomUUID();
    private final UUID jobOwnerRecruiterId = UUID.randomUUID();
    private final UUID companyId = UUID.randomUUID();
    private final ApplicationEntity applied = ApplicationEntity.applied(
        applicationId,
        UUID.randomUUID(),
        companyId,
        candidateId,
        jobOwnerRecruiterId,
        UUID.randomUUID(),
        "Backend Engineer",
        null,
        ApplicationSource.SEARCH,
        NOW.minusSeconds(3600)
    );

    @BeforeEach
    void setUp() {
        service = new ApplicationPipelineService(
            applications,
            history,
            outbox,
            offers,
            companies,
            new ObjectMapper().findAndRegisterModules(),
            Clock.fixed(NOW, ZoneOffset.UTC),
            "application-events"
        );
        when(applications.findById(applicationId))
            .thenReturn(Optional.of(applied));
        when(companies.getRecruiterMembership(recruiterId, "Bearer token"))
            .thenReturn(new RecruiterCompanyMembership(
                companyId,
                CompanyMemberRole.MEMBER
            ));
        when(applications.transition(any(), any(), any(), eq(0L)))
            .thenReturn(1);
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void companyMemberRolesManageApplicationFromAnotherRecruitersJob(
        CompanyMemberRole role
    ) throws Exception {
        when(companies.getRecruiterMembership(recruiterId, "Bearer token"))
            .thenReturn(new RecruiterCompanyMembership(companyId, role));

        StatusTransitionResponse response = service.changeStatus(
            applicationId,
            recruiterId,
            "Bearer token",
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REVIEWING,
                "  Qualified CV  ",
                0L
            )
        );

        assertThat(response.fromStatus()).isEqualTo(ApplicationStatus.APPLIED);
        assertThat(response.toStatus()).isEqualTo(ApplicationStatus.REVIEWING);
        assertThat(response.version()).isEqualTo(1L);
        assertThat(applied.getRecruiterId())
            .isEqualTo(jobOwnerRecruiterId)
            .isNotEqualTo(recruiterId);
        verify(history).append(
            applicationId,
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            recruiterId,
            "Qualified CV",
            NOW
        );
        ArgumentCaptor<ApplicationEventOutboxEntity> event =
            ArgumentCaptor.forClass(ApplicationEventOutboxEntity.class);
        verify(outbox).save(event.capture());
        JsonNode payload = new ObjectMapper().findAndRegisterModules()
            .readTree(event.getValue().getPayload());
        assertThat(payload.path("schema_version").asInt()).isEqualTo(1);
        assertThat(payload.path("actor_id").asText())
            .isEqualTo(recruiterId.toString());
        assertThat(payload.path("from_status").asText())
            .isEqualTo("APPLIED");
        assertThat(payload.path("to_status").asText())
            .isEqualTo("REVIEWING");
        assertThat(payload.path("aggregate_version").asLong()).isEqualTo(1L);
    }

    @Test
    void recruiterCannotSkipFromAppliedToInterview() {
        assertThatThrownBy(() -> service.changeStatus(
            applicationId,
            recruiterId,
            "Bearer token",
            new ChangeApplicationStatusRequest(
                ApplicationStatus.INTERVIEW,
                null,
                0L
            )
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("INVALID_APPLICATION_TRANSITION");
        verify(applications, never()).transition(any(), any(), any(), anyLong());
    }

    @Test
    void recruiterFromAnotherCompanyCannotChangeStatus() {
        when(companies.getRecruiterMembership(recruiterId, "Bearer token"))
            .thenReturn(new RecruiterCompanyMembership(
                UUID.randomUUID(),
                CompanyMemberRole.MEMBER
            ));

        assertThatThrownBy(() -> service.changeStatus(
            applicationId,
            recruiterId,
            "Bearer token",
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REVIEWING,
                null,
                0L
            )
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_ACCESS_DENIED");
        verify(applications, never()).transition(any(), any(), any(), anyLong());
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void rejectionRequiresAReason() {
        assertThatThrownBy(() -> service.changeStatus(
            applicationId,
            recruiterId,
            "Bearer token",
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REJECTED,
                "   ",
                0L
            )
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("REJECTION_REASON_REQUIRED");
    }

    @Test
    void candidateWithdrawsOwnActiveApplication() throws Exception {
        StatusTransitionResponse response = service.withdraw(
            applicationId,
            candidateId,
            new WithdrawApplicationRequest("Personal reason", 0L)
        );

        assertThat(response.toStatus()).isEqualTo(ApplicationStatus.WITHDRAWN);
        verify(history).append(
            applicationId,
            ApplicationStatus.APPLIED,
            ApplicationStatus.WITHDRAWN,
            candidateId,
            "Personal reason",
            NOW
        );
        ArgumentCaptor<ApplicationEventOutboxEntity> event =
            ArgumentCaptor.forClass(ApplicationEventOutboxEntity.class);
        verify(outbox).save(event.capture());
        JsonNode payload = new ObjectMapper().findAndRegisterModules()
            .readTree(event.getValue().getPayload());
        assertThat(payload.path("actor_id").asText())
            .isEqualTo(candidateId.toString());
        assertThat(payload.path("aggregate_version").asLong()).isEqualTo(1L);
    }

    @Test
    void recruiterRejectionCancelsSentOfferBeforeApplicationTransition()
        throws Exception {
        OfferEntity offer = stubOfferedApplication(4L);
        when(offers.cancelSent(applicationId, NOW, 0L)).thenReturn(1);
        when(applications.transition(
            applicationId,
            ApplicationStatus.REJECTED,
            NOW,
            4L
        )).thenReturn(1);

        StatusTransitionResponse response = service.changeStatus(
            applicationId,
            recruiterId,
            "Bearer token",
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REJECTED,
                "Position closed",
                4L
            )
        );

        assertThat(response.fromStatus()).isEqualTo(ApplicationStatus.OFFER);
        assertThat(response.toStatus()).isEqualTo(ApplicationStatus.REJECTED);
        assertThat(response.version()).isEqualTo(5L);
        InOrder lockOrder = inOrder(offers, applications);
        lockOrder.verify(offers).cancelSent(applicationId, NOW, 0L);
        lockOrder.verify(applications).transition(
            applicationId,
            ApplicationStatus.REJECTED,
            NOW,
            4L
        );
        verify(offer).getVersion();
        ArgumentCaptor<ApplicationEventOutboxEntity> event =
            ArgumentCaptor.forClass(ApplicationEventOutboxEntity.class);
        verify(outbox).save(event.capture());
        JsonNode payload = new ObjectMapper().findAndRegisterModules()
            .readTree(event.getValue().getPayload());
        assertThat(payload.path("action").asText())
            .isEqualTo("STATUS_CHANGED");
        assertThat(payload.path("from_status").asText()).isEqualTo("OFFER");
        assertThat(payload.path("to_status").asText()).isEqualTo("REJECTED");
        assertThat(payload.has("offer_id")).isFalse();
        assertThat(payload.has("offer_status")).isFalse();
        assertThat(payload.has("offer_version")).isFalse();
    }

    @Test
    void candidateWithdrawalCancelsSentOfferAtomically() {
        stubOfferedApplication(7L);
        when(offers.cancelSent(applicationId, NOW, 0L)).thenReturn(1);
        when(applications.transition(
            applicationId,
            ApplicationStatus.WITHDRAWN,
            NOW,
            7L
        )).thenReturn(1);

        StatusTransitionResponse response = service.withdraw(
            applicationId,
            candidateId,
            new WithdrawApplicationRequest("Accepted elsewhere", 7L)
        );

        assertThat(response.fromStatus()).isEqualTo(ApplicationStatus.OFFER);
        assertThat(response.toStatus()).isEqualTo(ApplicationStatus.WITHDRAWN);
        verify(offers).cancelSent(applicationId, NOW, 0L);
        verify(history).append(
            applicationId,
            ApplicationStatus.OFFER,
            ApplicationStatus.WITHDRAWN,
            candidateId,
            "Accepted elsewhere",
            NOW
        );
    }

    @Test
    void offeredApplicationWithoutOfferFailsClosed() {
        stubOfferedApplication(2L);
        when(offers.findByApplicationId(applicationId))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.withdraw(
            applicationId,
            candidateId,
            new WithdrawApplicationRequest(null, 2L)
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(exception -> {
                BusinessException business = (BusinessException) exception;
                assertThat(business.code())
                    .isEqualTo("APPLICATION_OFFER_INCONSISTENT");
                assertThat(business.status())
                    .isEqualTo(org.springframework.http.HttpStatus
                        .SERVICE_UNAVAILABLE);
            });

        verify(applications, never()).transition(any(), any(), any(), anyLong());
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void offerCancellationRaceFailsBeforeApplicationMutation() {
        stubOfferedApplication(3L);
        when(offers.cancelSent(applicationId, NOW, 0L)).thenReturn(0);

        assertThatThrownBy(() -> service.changeStatus(
            applicationId,
            recruiterId,
            "Bearer token",
            new ChangeApplicationStatusRequest(
                ApplicationStatus.REJECTED,
                "No longer hiring",
                3L
            )
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_CHANGED_CONCURRENTLY");

        verify(applications, never()).transition(any(), any(), any(), anyLong());
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void anotherCandidateCannotWithdrawApplication() {
        assertThatThrownBy(() -> service.withdraw(
            applicationId,
            UUID.randomUUID(),
            new WithdrawApplicationRequest(null, 0L)
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_ACCESS_DENIED");
        verify(applications, never()).transition(any(), any(), any(), anyLong());
    }

    @Test
    void staleVersionIsRejectedBeforeUpdate() {
        assertThatThrownBy(() -> service.withdraw(
            applicationId,
            candidateId,
            new WithdrawApplicationRequest(null, 2L)
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_CHANGED_CONCURRENTLY");
    }

    @Test
    void atomicUpdateDetectsAConcurrentChange() {
        when(applications.transition(any(), any(), any(), eq(0L)))
            .thenReturn(0);

        assertThatThrownBy(() -> service.withdraw(
            applicationId,
            candidateId,
            new WithdrawApplicationRequest(null, 0L)
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("APPLICATION_CHANGED_CONCURRENTLY");
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    @SuppressWarnings("unchecked")
    void companyMemberRolesListApplicationsAcrossCompanyJobs(
        CompanyMemberRole role
    ) {
        when(companies.getRecruiterMembership(recruiterId, "Bearer token"))
            .thenReturn(new RecruiterCompanyMembership(companyId, role));
        when(applications.findAll(
            any(Specification.class),
            any(Pageable.class)
        )).thenReturn(new PageImpl<>(List.of(applied)));

        RecruiterApplicationPageResponse response = service.listForRecruiter(
            recruiterId,
            "Bearer token",
            null,
            ApplicationStatus.APPLIED,
            null,
            null,
            ApplicationSort.APPLIED_AT_DESC,
            0,
            20
        );

        assertThat(response.items()).hasSize(1);
        assertThat(response.items().getFirst().candidateId())
            .isEqualTo(candidateId);
        verify(companies).getRecruiterMembership(recruiterId, "Bearer token");
    }

    @Test
    void rejectsInvalidPaginationBeforeCallingCompanyService() {
        assertThatThrownBy(() -> service.listForRecruiter(
            recruiterId,
            "Bearer token",
            null,
            null,
            null,
            null,
            ApplicationSort.APPLIED_AT_DESC,
            0,
            101
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("INVALID_PAGINATION");
        verify(companies, never()).getRecruiterMembership(any(), any());
    }

    @Test
    void rejectsInvalidSkillFilterBeforeCallingCompanyService() {
        assertThatThrownBy(() -> service.listForRecruiter(
            recruiterId,
            "Bearer token",
            null,
            null,
            null,
            null,
            List.of("Java", "java"),
            ApplicationSort.APPLIED_AT_DESC,
            0,
            20
        ))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("INVALID_SKILL_FILTER");
        verify(companies, never()).getRecruiterMembership(any(), any());
    }

    private OfferEntity stubOfferedApplication(long version) {
        ApplicationEntity offered = mock(ApplicationEntity.class);
        when(offered.getId()).thenReturn(applicationId);
        when(offered.getJobId()).thenReturn(applied.getJobId());
        when(offered.getCompanyId()).thenReturn(companyId);
        when(offered.getCandidateId()).thenReturn(candidateId);
        when(offered.getRecruiterId()).thenReturn(jobOwnerRecruiterId);
        when(offered.getJobTitle()).thenReturn("Backend Engineer");
        when(offered.getStatus()).thenReturn(ApplicationStatus.OFFER);
        when(offered.getVersion()).thenReturn(version);
        when(applications.findById(applicationId))
            .thenReturn(Optional.of(offered));

        OfferEntity offer = mock(OfferEntity.class);
        when(offer.getApplicationId()).thenReturn(applicationId);
        when(offer.getStatus()).thenReturn(OfferStatus.SENT);
        when(offer.getVersion()).thenReturn(0L);
        when(offers.findByApplicationId(applicationId))
            .thenReturn(Optional.of(offer));
        return offer;
    }
}
