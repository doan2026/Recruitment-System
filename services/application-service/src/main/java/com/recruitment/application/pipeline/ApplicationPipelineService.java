package com.recruitment.application.pipeline;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.domain.OfferEntity;
import com.recruitment.application.domain.OfferStatus;
import com.recruitment.application.event.ApplicationEventV1;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.OfferRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ApplicationPipelineService {
    private static final EnumSet<ApplicationStatus> WITHDRAWABLE = EnumSet.of(
        ApplicationStatus.APPLIED,
        ApplicationStatus.REVIEWING,
        ApplicationStatus.INTERVIEW,
        ApplicationStatus.OFFER
    );

    private final ApplicationPipelineRepository applications;
    private final ApplicationHistoryWriter history;
    private final ApplicationEventOutboxRepository outbox;
    private final OfferRepository offers;
    private final CompanyClient companies;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final String topic;

    @Autowired
    public ApplicationPipelineService(
        ApplicationPipelineRepository applications,
        ApplicationHistoryWriter history,
        ApplicationEventOutboxRepository outbox,
        OfferRepository offers,
        CompanyClient companies,
        ObjectMapper objectMapper,
        @Value("${application-events.topic}") String topic
    ) {
        this(
            applications,
            history,
            outbox,
            offers,
            companies,
            objectMapper,
            Clock.systemUTC(),
            topic
        );
    }

    ApplicationPipelineService(
        ApplicationPipelineRepository applications,
        ApplicationHistoryWriter history,
        ApplicationEventOutboxRepository outbox,
        OfferRepository offers,
        CompanyClient companies,
        ObjectMapper objectMapper,
        Clock clock,
        String topic
    ) {
        this.applications = applications;
        this.history = history;
        this.outbox = outbox;
        this.offers = offers;
        this.companies = companies;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.topic = topic;
    }

    @Transactional(readOnly = true)
    public RecruiterApplicationPageResponse listForRecruiter(
        UUID recruiterId,
        String authorization,
        UUID jobId,
        ApplicationStatus status,
        Instant appliedFrom,
        Instant appliedTo,
        List<String> rawSkills,
        ApplicationSort sort,
        int page,
        int size
    ) {
        validatePageAndRange(page, size, appliedFrom, appliedTo);
        List<String> skills = ApplicationSkillFilter.parse(rawSkills);
        UUID companyId = authorizedCompanyId(recruiterId, authorization);
        Page<ApplicationEntity> result = applications.findAll(
            ApplicationSpecifications.recruiterFilter(
                companyId,
                jobId,
                status,
                appliedFrom,
                appliedTo,
                skills,
                sort
            ),
            PageRequest.of(page, size)
        );
        return new RecruiterApplicationPageResponse(
            result.getContent().stream()
                .map(RecruiterApplicationItemResponse::from)
                .toList(),
            result.getNumber(),
            result.getSize(),
            result.getTotalElements(),
            result.getTotalPages()
        );
    }

    @Transactional(readOnly = true)
    public RecruiterApplicationPageResponse listForRecruiter(
        UUID recruiterId,
        String authorization,
        UUID jobId,
        ApplicationStatus status,
        Instant appliedFrom,
        Instant appliedTo,
        ApplicationSort sort,
        int page,
        int size
    ) {
        return listForRecruiter(
            recruiterId,
            authorization,
            jobId,
            status,
            appliedFrom,
            appliedTo,
            List.of(),
            sort,
            page,
            size
        );
    }

    @Transactional
    public StatusTransitionResponse changeStatus(
        UUID applicationId,
        UUID recruiterId,
        String authorization,
        ChangeApplicationStatusRequest request
    ) {
        ApplicationEntity application = find(applicationId);
        authorizeRecruiter(application, recruiterId, authorization);
        ensureVersion(application, request.expectedVersion());
        validateRecruiterTransition(
            application.getStatus(),
            request.status(),
            request.note()
        );
        return transition(
            application,
            recruiterId,
            request.status(),
            request.note(),
            request.expectedVersion()
        );
    }

    @Transactional
    public StatusTransitionResponse withdraw(
        UUID applicationId,
        UUID candidateId,
        WithdrawApplicationRequest request
    ) {
        ApplicationEntity application = find(applicationId);
        if (!application.getCandidateId().equals(candidateId)) {
            throw denied();
        }
        ensureVersion(application, request.expectedVersion());
        if (!WITHDRAWABLE.contains(application.getStatus())) {
            throw new BusinessException(
                "APPLICATION_NOT_WITHDRAWABLE",
                "Only an active application can be withdrawn",
                HttpStatus.CONFLICT,
                Map.of("currentStatus", application.getStatus().name())
            );
        }
        return transition(
            application,
            candidateId,
            ApplicationStatus.WITHDRAWN,
            request.note(),
            request.expectedVersion()
        );
    }

    private StatusTransitionResponse transition(
        ApplicationEntity application,
        UUID actorId,
        ApplicationStatus target,
        String rawNote,
        long expectedVersion
    ) {
        Instant now = clock.instant();
        String note = cleanNote(rawNote);
        UUID eventId = UUID.randomUUID();
        String payload = eventPayload(
            eventId,
            application,
            actorId,
            target,
            expectedVersion + 1,
            now
        );
        cancelSentOfferForTerminalTransition(application, target, now);
        int changed = applications.transition(
            application.getId(),
            target,
            now,
            expectedVersion
        );
        if (changed != 1) {
            throw concurrentChange();
        }
        history.append(
            application.getId(),
            application.getStatus(),
            target,
            actorId,
            note,
            now
        );
        outbox.save(ApplicationEventOutboxEntity.pending(
            eventId,
            application.getId(),
            topic,
            payload,
            now
        ));
        return new StatusTransitionResponse(
            application.getId(),
            application.getStatus(),
            target,
            now,
            expectedVersion + 1
        );
    }

    private void cancelSentOfferForTerminalTransition(
        ApplicationEntity application,
        ApplicationStatus target,
        Instant now
    ) {
        if (
            application.getStatus() != ApplicationStatus.OFFER ||
            (
                target != ApplicationStatus.REJECTED &&
                target != ApplicationStatus.WITHDRAWN
            )
        ) {
            return;
        }

        OfferEntity offer = offers.findByApplicationId(application.getId())
            .orElseThrow(this::inconsistentOfferState);
        // An expired Offer is already terminal and can never be responded to,
        // so the terminal Application transition has nothing left to cancel.
        // Treating it as a conflict would strand the Application in OFFER.
        if (offer.getStatus() == OfferStatus.EXPIRED) {
            return;
        }
        if (offer.getStatus() != OfferStatus.SENT) {
            throw concurrentChange();
        }

        // Candidate response takes the same Offer -> Application lock order.
        // Keeping that order here avoids a cross-path row-lock deadlock.
        int changed = offers.cancelSent(
            application.getId(),
            now,
            offer.getVersion()
        );
        if (changed != 1) {
            throw concurrentChange();
        }
    }

    private void validateRecruiterTransition(
        ApplicationStatus current,
        ApplicationStatus target,
        String note
    ) {
        boolean allowed = target == ApplicationStatus.REJECTED
            ? EnumSet.of(
                ApplicationStatus.APPLIED,
                ApplicationStatus.REVIEWING,
                ApplicationStatus.INTERVIEW,
                ApplicationStatus.OFFER
            ).contains(current)
            : current == ApplicationStatus.APPLIED &&
                target == ApplicationStatus.REVIEWING ||
                current == ApplicationStatus.REVIEWING &&
                target == ApplicationStatus.INTERVIEW;
        if (!allowed) {
            throw new BusinessException(
                "INVALID_APPLICATION_TRANSITION",
                "This application status transition is not allowed",
                HttpStatus.CONFLICT,
                Map.of(
                    "fromStatus", current.name(),
                    "toStatus", target.name()
                )
            );
        }
        if (target == ApplicationStatus.REJECTED && cleanNote(note) == null) {
            throw new BusinessException(
                "REJECTION_REASON_REQUIRED",
                "A rejection reason is required",
                HttpStatus.BAD_REQUEST
            );
        }
    }

    private void validatePageAndRange(
        int page,
        int size,
        Instant appliedFrom,
        Instant appliedTo
    ) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BusinessException(
                "INVALID_PAGINATION",
                "page must be at least 0 and size must be between 1 and 100",
                HttpStatus.BAD_REQUEST
            );
        }
        if (appliedFrom != null && appliedTo != null &&
            appliedFrom.isAfter(appliedTo)) {
            throw new BusinessException(
                "INVALID_APPLIED_RANGE",
                "appliedFrom must not be after appliedTo",
                HttpStatus.BAD_REQUEST
            );
        }
    }

    private void authorizeRecruiter(
        ApplicationEntity application,
        UUID recruiterId,
        String authorization
    ) {
        UUID companyId = authorizedCompanyId(recruiterId, authorization);
        if (!application.getCompanyId().equals(companyId)) {
            throw denied();
        }
    }

    private UUID authorizedCompanyId(
        UUID recruiterId,
        String authorization
    ) {
        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(
                recruiterId,
                authorization
            );
        if (!membership.canManageAllCompanyApplications()) {
            throw denied();
        }
        return membership.companyId();
    }

    private void ensureVersion(ApplicationEntity application, long expected) {
        if (application.getVersion() != expected) {
            throw concurrentChange();
        }
    }

    private ApplicationEntity find(UUID applicationId) {
        return applications.findById(applicationId).orElseThrow(() ->
            new BusinessException(
                "APPLICATION_NOT_FOUND",
                "Application was not found",
                HttpStatus.NOT_FOUND
            )
        );
    }

    private String cleanNote(String note) {
        if (note == null) return null;
        String cleaned = note.strip();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private BusinessException denied() {
        return new BusinessException(
            "APPLICATION_ACCESS_DENIED",
            "You cannot manage this application",
            HttpStatus.FORBIDDEN
        );
    }

    private BusinessException concurrentChange() {
        return new BusinessException(
            "APPLICATION_CHANGED_CONCURRENTLY",
            "Application changed concurrently; reload and try again",
            HttpStatus.CONFLICT
        );
    }

    private BusinessException inconsistentOfferState() {
        return new BusinessException(
            "APPLICATION_OFFER_INCONSISTENT",
            "Application offer state is inconsistent",
            HttpStatus.SERVICE_UNAVAILABLE
        );
    }

    private String eventPayload(
        UUID eventId,
        ApplicationEntity application,
        UUID actorId,
        ApplicationStatus target,
        long aggregateVersion,
        Instant occurredAt
    ) {
        Map<String, Object> event = ApplicationEventV1.base(
            eventId,
            ApplicationEventV1.Action.STATUS_CHANGED,
            application,
            actorId,
            application.getStatus(),
            target,
            aggregateVersion,
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
