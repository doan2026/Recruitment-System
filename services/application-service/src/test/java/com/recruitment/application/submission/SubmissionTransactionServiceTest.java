package com.recruitment.application.submission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import com.recruitment.application.domain.ApplicationHistoryEntity;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.ApplicationHistoryRepository;
import com.recruitment.application.repository.ApplicationRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class SubmissionTransactionServiceTest {
    private static final Instant NOW =
        Instant.parse("2026-08-24T08:00:00Z");

    private final ApplicationRepository applications =
        mock(ApplicationRepository.class);
    private final CvSubmissionGateService cvSubmissionGate =
        mock(CvSubmissionGateService.class);
    private final ApplicationHistoryRepository history =
        mock(ApplicationHistoryRepository.class);
    private final ApplicationEventOutboxRepository outbox =
        mock(ApplicationEventOutboxRepository.class);
    private SubmissionTransactionService service;

    private final UUID candidateId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private final UUID cvId = UUID.randomUUID();
    private final UUID companyId = UUID.randomUUID();
    private final UUID recruiterId = UUID.randomUUID();
    private final CreateApplicationRequest request =
        new CreateApplicationRequest(jobId, cvId, "  Hello HR  ", null);

    @BeforeEach
    void setUp() {
        service = new SubmissionTransactionService(
            cvSubmissionGate,
            applications,
            history,
            outbox,
            new ObjectMapper().findAndRegisterModules(),
            Clock.fixed(NOW, ZoneOffset.UTC),
            "application-events"
        );
        when(
            applications.existsByCandidateIdAndJobIdAndStatusIn(
                any(),
                any(),
                any()
            )
        ).thenReturn(false);
        when(
            applications
                .findFirstByCandidateIdAndJobIdOrderByAppliedAtDesc(
                    candidateId,
                    jobId
                )
        ).thenReturn(Optional.empty());
    }

    @Test
    void writesApplicationHistoryAndOutboxTogether() {
        ApplicationResponse response = service.create(
            candidateId,
            request,
            availableJob()
        );

        assertThat(response.status()).isEqualTo(ApplicationStatus.APPLIED);
        assertThat(response.coverLetter()).isEqualTo("Hello HR");
        verify(applications).saveAndFlush(any(ApplicationEntity.class));
        verify(cvSubmissionGate).lockForSubmission(candidateId, cvId);
        verify(history).save(any(ApplicationHistoryEntity.class));

        ArgumentCaptor<ApplicationEventOutboxEntity> captor =
            ArgumentCaptor.forClass(ApplicationEventOutboxEntity.class);
        verify(outbox).save(captor.capture());
        assertThat(captor.getValue().getTopic())
            .isEqualTo("application-events");
        assertThat(captor.getValue().getPayload())
            .contains("\"action\":\"STATUS_CHANGED\"")
            .contains("\"to_status\":\"APPLIED\"")
            .contains(jobId.toString());
    }

    @Test
    void fencedCvIsRejectedBeforeDuplicateChecksOrWrites() {
        doThrow(new BusinessException(
            "CV_NOT_AVAILABLE",
            "The selected CV is no longer available",
            org.springframework.http.HttpStatus.BAD_REQUEST
        )).when(cvSubmissionGate).lockForSubmission(candidateId, cvId);

        assertThatThrownBy(() ->
            service.create(candidateId, request, availableJob())
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("CV_NOT_AVAILABLE");

        verify(applications, never())
            .existsByCandidateIdAndJobIdAndStatusIn(any(), any(), any());
        verify(applications, never()).saveAndFlush(any());
        verifyNoDownstreamWrites();
    }

    @Test
    void rejectsAnExistingActiveApplication() {
        when(
            applications.existsByCandidateIdAndJobIdAndStatusIn(
                any(),
                any(),
                any()
            )
        ).thenReturn(true);

        assertThatThrownBy(() ->
            service.create(candidateId, request, availableJob())
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("ACTIVE_APPLICATION_EXISTS");
        verify(applications, never()).saveAndFlush(any());
    }

    private void verifyNoDownstreamWrites() {
        verify(history, never()).save(any());
        verify(outbox, never()).save(any());
    }

    @Test
    void enforcesThirtyDayCooldownAfterRejection() {
        ApplicationEntity previous = mock(ApplicationEntity.class);
        when(previous.getStatus()).thenReturn(ApplicationStatus.REJECTED);
        when(previous.getUpdatedAt()).thenReturn(NOW.minusSeconds(10 * 86400));
        when(
            applications
                .findFirstByCandidateIdAndJobIdOrderByAppliedAtDesc(
                    candidateId,
                    jobId
                )
        ).thenReturn(Optional.of(previous));

        assertThatThrownBy(() ->
            service.create(candidateId, request, availableJob())
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("REAPPLICATION_COOLDOWN");
        verify(applications, never()).saveAndFlush(any());
    }

    private JobAvailability availableJob() {
        return new JobAvailability(
            jobId,
            true,
            true,
            null,
            companyId,
            recruiterId,
            "Backend Engineer",
            "PUBLISHED",
            "2099-12-31"
        );
    }
}
