package com.recruitment.application.submission;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.client.ProfileClient;
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
        when(jobs.getAvailability(jobId)).thenReturn(job);
        when(profiles.candidateOwnsCv(candidateId, cvId, "Bearer token"))
            .thenReturn(true);

        service.submit(candidateId, "Bearer token", request);

        verify(transactions).create(candidateId, request, job);
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
        verify(profiles, never()).candidateOwnsCv(
            candidateId,
            cvId,
            "Bearer token"
        );
    }

    @Test
    void rejectsACvThatDoesNotBelongToCandidate() {
        when(jobs.getAvailability(jobId)).thenReturn(availableJob());
        when(profiles.candidateOwnsCv(candidateId, cvId, "Bearer token"))
            .thenReturn(false);

        assertThatThrownBy(() ->
            service.submit(candidateId, "Bearer token", request)
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("CV_NOT_AVAILABLE");
        verify(transactions, never()).create(
            candidateId,
            request,
            availableJob()
        );
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
