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
import com.recruitment.application.event.ApplicationEventV1;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.ApplicationHistoryRepository;
import com.recruitment.application.repository.ApplicationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
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

    private final CvSubmissionGateService cvSubmissionGate;
    private final ApplicationRepository applications;
    private final ApplicationProfileSkillSnapshotWriter skillSnapshots;
    private final ApplicationHistoryRepository history;
    private final ApplicationEventOutboxRepository outbox;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final String topic;

    @Autowired
    public SubmissionTransactionService(
        CvSubmissionGateService cvSubmissionGate,
        ApplicationRepository applications,
        ApplicationProfileSkillSnapshotWriter skillSnapshots,
        ApplicationHistoryRepository history,
        ApplicationEventOutboxRepository outbox,
        ObjectMapper objectMapper,
        @Value("${application-events.topic}") String topic
    ) {
        this(
            cvSubmissionGate,
            applications,
            skillSnapshots,
            history,
            outbox,
            objectMapper,
            Clock.systemUTC(),
            topic
        );
    }

    SubmissionTransactionService(
        CvSubmissionGateService cvSubmissionGate,
        ApplicationRepository applications,
        ApplicationProfileSkillSnapshotWriter skillSnapshots,
        ApplicationHistoryRepository history,
        ApplicationEventOutboxRepository outbox,
        ObjectMapper objectMapper,
        Clock clock,
        String topic
    ) {
        this.cvSubmissionGate = cvSubmissionGate;
        this.applications = applications;
        this.skillSnapshots = skillSnapshots;
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
        JobAvailability job,
        ProfileSkillSnapshot skillSnapshot
    ) {
        cvSubmissionGate.lockForSubmission(candidateId, request.cvId());
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
            skillSnapshot.schemaVersion(),
            skillSnapshot.profileAggregateVersion(),
            skillSnapshot.skills().size(),
            now
        );

        try {
            applications.saveAndFlush(application);
        } catch (DataIntegrityViolationException exception) {
            throw duplicate();
        }
        try {
            skillSnapshots.save(applicationId, skillSnapshot.skills());
        } catch (DataIntegrityViolationException exception) {
            throw invalidProfileSkillSnapshot();
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

    private BusinessException invalidProfileSkillSnapshot() {
        return new BusinessException(
            "PROFILE_SERVICE_INVALID_RESPONSE",
            "Profile Service returned an invalid skill snapshot",
            HttpStatus.BAD_GATEWAY
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
        Map<String, Object> event = ApplicationEventV1.base(
            eventId,
            ApplicationEventV1.Action.STATUS_CHANGED,
            application,
            application.getCandidateId(),
            null,
            application.getStatus(),
            application.getVersion(),
            occurredAt
        );
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
