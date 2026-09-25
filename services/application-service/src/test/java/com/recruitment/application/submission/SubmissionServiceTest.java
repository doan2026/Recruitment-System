package com.recruitment.application.submission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.client.ProfileClient;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SubmissionServiceTest {
    private final JobClient jobs = mock(JobClient.class);
    private final ProfileClient profiles = mock(ProfileClient.class);
    private final SubmissionTransactionService transactions =
        mock(SubmissionTransactionService.class);
    private SubmissionService service;

    private final UUID candidateId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private final UUID cvId = UUID.randomUUID();
    private final UUID companyId = UUID.randomUUID();
    private final UUID recruiterId = UUID.randomUUID();
    private final CreateApplicationRequest request =
        new CreateApplicationRequest(jobId, cvId, "Hello", null);

    @BeforeEach
    void setUp() {
        service = new SubmissionService(jobs, profiles, transactions);
    }

    @Test
    void submitsAfterJobAndCvValidation() {
        JobAvailability job = availableJob();
        ProfileSkillSnapshot snapshot = new ProfileSkillSnapshot(
            1,
            7,
            List.of("Java", "PostgreSQL")
        );
        when(jobs.getAvailability(jobId)).thenReturn(job);
        when(profiles.verifyCandidateCvForSubmission(
            candidateId,
            cvId,
            "Bearer token"
        )).thenReturn(Optional.of(snapshot));

        service.submit(candidateId, "Bearer token", request);

        verify(transactions).create(candidateId, request, job, snapshot);
    }

    @Test
    void rejectsAClosedJobBeforeCallingProfile() {
        when(jobs.getAvailability(jobId)).thenReturn(
            new JobAvailability(
                jobId,
                true,
                false,
                "NOT_PUBLISHED",
                companyId,
                recruiterId,
                "Backend Engineer",
                "CLOSED",
                "2099-12-31"
            )
        );

        assertThatThrownBy(() ->
            service.submit(candidateId, "Bearer token", request)
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("JOB_NOT_ACCEPTING_APPLICATIONS");
        verify(profiles, never()).verifyCandidateCvForSubmission(
            candidateId,
            cvId,
            "Bearer token"
        );
    }

    @Test
    void rejectsACvThatDoesNotBelongToCandidate() {
        when(jobs.getAvailability(jobId)).thenReturn(availableJob());
        when(profiles.verifyCandidateCvForSubmission(
            candidateId,
            cvId,
            "Bearer token"
        )).thenReturn(Optional.empty());

        assertThatThrownBy(() ->
            service.submit(candidateId, "Bearer token", request)
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("CV_NOT_AVAILABLE");
        verify(transactions, never()).create(any(), any(), any(), any());
    }

    @Test
    void submitsAJobWhoseLegacyTitleContainsControlCharacters() {
        JobAvailability legacy = new JobAvailability(
            jobId,
            true,
            true,
            null,
            companyId,
            recruiterId,
            "Backend\tEngineer\u0007",
            "PUBLISHED",
            "2099-12-31"
        );
        ProfileSkillSnapshot snapshot = new ProfileSkillSnapshot(1, 7, List.of("Java"));
        when(jobs.getAvailability(jobId)).thenReturn(legacy);
        when(profiles.verifyCandidateCvForSubmission(
            candidateId,
            cvId,
            "Bearer token"
        )).thenReturn(Optional.of(snapshot));

        service.submit(candidateId, "Bearer token", request);

        verify(transactions).create(candidateId, request, availableJob(), snapshot);
    }

    @Test
    void eventSafeJobTitleSatisfiesTheApplicationEventsContract() {
        assertThat(SubmissionService.eventSafeJobTitle("Backend\tEngineer"))
            .isEqualTo("Backend Engineer");
        assertThat(SubmissionService.eventSafeJobTitle("  A\r\n\u007FB  "))
            .isEqualTo("A B");
        assertThat(SubmissionService.eventSafeJobTitle("\t\n")).isNull();
        assertThat(SubmissionService.eventSafeJobTitle(null)).isNull();
        assertThat(SubmissionService.eventSafeJobTitle("x".repeat(250)))
            .hasSize(200);
        String astral = "a".repeat(199) + "\uD840\uDC00";
        assertThat(SubmissionService.eventSafeJobTitle(astral))
            .isEqualTo("a".repeat(199));
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
