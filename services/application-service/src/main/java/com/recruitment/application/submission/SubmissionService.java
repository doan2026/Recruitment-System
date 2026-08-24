package com.recruitment.application.submission;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.client.ProfileClient;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class SubmissionService {
    private final JobClient jobs;
    private final ProfileClient profiles;
    private final SubmissionTransactionService transactions;

    public SubmissionService(
        JobClient jobs,
        ProfileClient profiles,
        SubmissionTransactionService transactions
    ) {
        this.jobs = jobs;
        this.profiles = profiles;
        this.transactions = transactions;
    }

    public ApplicationResponse submit(
        UUID candidateId,
        String authorization,
        CreateApplicationRequest request
    ) {
        JobAvailability job = jobs.getAvailability(request.jobId());
        validateJob(job);
        if (
            !profiles.candidateOwnsCv(
                candidateId,
                request.cvId(),
                authorization
            )
        ) {
            throw new BusinessException(
                "CV_NOT_AVAILABLE",
                "The selected CV does not exist or is not available to this candidate",
                HttpStatus.BAD_REQUEST
            );
        }
        return transactions.create(candidateId, request, job);
    }

    private void validateJob(JobAvailability job) {
        if (!job.exists()) {
            throw new BusinessException(
                "JOB_NOT_FOUND",
                "Job was not found",
                HttpStatus.NOT_FOUND
            );
        }
        if (
            !job.acceptingApplications() ||
            job.companyId() == null ||
            job.recruiterId() == null ||
            job.jobTitle() == null
        ) {
            throw new BusinessException(
                "JOB_NOT_ACCEPTING_APPLICATIONS",
                "Job is not accepting applications",
                HttpStatus.CONFLICT,
                Map.of("reason", job.reason() == null ? "UNKNOWN" : job.reason())
            );
        }
    }
}
