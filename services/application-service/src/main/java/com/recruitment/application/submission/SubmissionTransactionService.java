package com.recruitment.application.submission;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.JobClient.JobAvailability;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import com.recruitment.application.domain.ApplicationHistoryEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.ApplicationHistoryRepository;
import com.recruitment.application.repository.ApplicationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SubmissionTransactionService {
    private static final EnumSet<ApplicationStatus> ACTIVE_STATUSES =
        EnumSet.of(
            ApplicationStatus.APPLIED,
            ApplicationStatus.REVIEWING,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED
        );
    private static final Duration REJECTION_COOLDOWN = Duration.ofDays(30);

    private final ApplicationRepository applications;
    private final ApplicationHistoryRepository history;
    private final ApplicationEventOutboxRepository outbox;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final String topic;

    public SubmissionTransactionService(
        ApplicationRepository applications,
        ApplicationHistoryRepository history,
        ApplicationEventOutboxRepository outbox,
        ObjectMapper objectMapper,
        @Value("${application-events.topic}") String topic
    ) {
        this(
            applications,
            history,
            outbox,
            objectMapper,
            Clock.systemUTC(),
            topic
        );
    }

    SubmissionTransactionService(
        ApplicationRepository applications,
        ApplicationHistoryRepository history,
        ApplicationEventOutboxRepository outbox,
        ObjectMapper objectMapper,
        Clock clock,
        String topic
    ) {
        this.applications = applications;
        this.history = history;
        this.outbox = outbox;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.topic = topic;
    }

    @Transactional
    public ApplicationResponse create(
        UUID candidateId,
        CreateApplicationRequest request,
        JobAvailability job
    ) {
        rejectDuplicateOrCooldown(candidateId, request.jobId());
        Instant now = clock.instant();
        UUID applicationId = UUID.randomUUID();
        ApplicationEntity application = ApplicationEntity.applied(
            applicationId,
            request.jobId(),
            job.companyId(),
            candidateId,
            job.recruiterId(),
            request.cvId(),
            job.jobTitle(),
            cleanCoverLetter(request.coverLetter()),
            request.source() == null
                ? ApplicationSource.SEARCH
                : request.source(),
            now
        );

        try {
            applications.saveAndFlush(application);
        } catch (DataIntegrityViolationException exception) {
            throw duplicate();
        }
        history.save(
            ApplicationHistoryEntity.initial(
                UUID.randomUUID(),
                applicationId,
                candidateId,
                now
            )
        );
        UUID eventId = UUID.randomUUID();
        outbox.save(
            ApplicationEventOutboxEntity.pending(
                eventId,
                applicationId,
                topic,
                eventPayload(eventId, application, now),
                now
            )
        );
        return ApplicationResponse.from(application);
    }

    private void rejectDuplicateOrCooldown(UUID candidateId, UUID jobId) {
        if (
            applications.existsByCandidateIdAndJobIdAndStatusIn(
                candidateId,
                jobId,
                ACTIVE_STATUSES
            )
        ) {
            throw duplicate();
        }
        applications
            .findFirstByCandidateIdAndJobIdOrderByAppliedAtDesc(
                candidateId,
                jobId
            )
            .filter(application ->
                application.getStatus() == ApplicationStatus.REJECTED
            )
            .ifPresent(application -> {
                Instant eligibleAt = application.getUpdatedAt()
                    .plus(REJECTION_COOLDOWN);
                if (eligibleAt.isAfter(clock.instant())) {
                    throw new BusinessException(
                        "REAPPLICATION_COOLDOWN",
                        "A rejected application can be submitted again after 30 days",
                        HttpStatus.CONFLICT,
                        Map.of("eligibleAt", eligibleAt.toString())
                    );
                }
            });
    }

    private BusinessException duplicate() {
        return new BusinessException(
            "ACTIVE_APPLICATION_EXISTS",
            "You have already applied for this job",
            HttpStatus.CONFLICT
        );
    }

    private String cleanCoverLetter(String coverLetter) {
        if (coverLetter == null) return null;
        String cleaned = coverLetter.strip();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private String eventPayload(
        UUID eventId,
        ApplicationEntity application,
        Instant occurredAt
    ) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("event_id", eventId);
        event.put("action", "STATUS_CHANGED");
        event.put("application_id", application.getId());
        event.put("job_id", application.getJobId());
        event.put("job_title", application.getJobTitle());
        event.put("candidate_id", application.getCandidateId());
        event.put("recruiter_id", application.getRecruiterId());
        event.put("from_status", null);
        event.put("to_status", application.getStatus());
        event.put("occurred_at", occurredAt);
        try {
            return objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                "Cannot serialize application event",
                exception
            );
        }
    }
}
