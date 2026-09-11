package com.recruitment.application.offer;

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
import com.recruitment.application.pipeline.ApplicationHistoryWriter;
import com.recruitment.application.pipeline.ApplicationPipelineRepository;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.OfferRepository;
import com.recruitment.application.tracking.TrackingViewerRole;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

@Service
public class ApplicationOfferService {
    private static final String OFFER_UNIQUE_CONSTRAINT =
        "offers_application_unique";
    private static final int MAX_POSITION_LENGTH = 200;
    private static final int MAX_NOTE_LENGTH = 2000;
    private static final int MAX_FILE_URL_LENGTH = 2048;
    private static final int MAX_SALARY_INTEGER_DIGITS = 17;

    private final ApplicationPipelineRepository applications;
    private final OfferRepository offers;
    private final ApplicationHistoryWriter history;
    private final ApplicationEventOutboxRepository outbox;
    private final CompanyClient companies;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final String topic;

    @Autowired
    public ApplicationOfferService(
        ApplicationPipelineRepository applications,
        OfferRepository offers,
        ApplicationHistoryWriter history,
        ApplicationEventOutboxRepository outbox,
        CompanyClient companies,
        ObjectMapper objectMapper,
        @Value("${application-events.topic}") String topic
    ) {
        this(
            applications,
            offers,
            history,
            outbox,
            companies,
            objectMapper,
            Clock.systemUTC(),
            topic
        );
    }

    ApplicationOfferService(
        ApplicationPipelineRepository applications,
        OfferRepository offers,
        ApplicationHistoryWriter history,
        ApplicationEventOutboxRepository outbox,
        CompanyClient companies,
        ObjectMapper objectMapper,
        Clock clock,
        String topic
    ) {
        this.applications = applications;
        this.offers = offers;
        this.history = history;
        this.outbox = outbox;
        this.companies = companies;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.topic = topic;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OfferResponse get(
        UUID offerId, UUID viewerId, TrackingViewerRole viewerRole,
        String authorization
    ) {
        OfferEntity offer = findOffer(offerId);
        ApplicationEntity application = findApplication(offer.getApplicationId());
        if (viewerRole == TrackingViewerRole.CANDIDATE) {
            if (!application.getCandidateId().equals(viewerId)) {
                throw new BusinessException(
                    "OFFER_ACCESS_DENIED", "You cannot view this offer",
                    HttpStatus.FORBIDDEN
                );
            }
        } else if (viewerRole == TrackingViewerRole.RECRUITER) {
            authorizeRecruiter(application, viewerId, authorization);
        } else {
            throw new BusinessException(
                "OFFER_ACCESS_DENIED", "You cannot view this offer",
                HttpStatus.FORBIDDEN
            );
        }
        return OfferResponse.current(offer, application);
    }

    @Transactional
    public OfferResponse send(
        UUID applicationId,
        UUID recruiterId,
        String authorization,
        CreateOfferRequest request
    ) {
        ApplicationEntity application = findApplication(applicationId);
        authorizeRecruiter(application, recruiterId, authorization);

        Instant now = clock.instant();
        long expectedApplicationVersion = requireVersion(
            request.expectedApplicationVersion(),
            "INVALID_APPLICATION_VERSION",
            "expectedApplicationVersion must not be negative"
        );
        NormalizedOffer normalized = normalize(request, now);

        if (offers.existsByApplicationId(applicationId)) {
            throw offerAlreadyExists();
        }
        if (application.getStatus() != ApplicationStatus.INTERVIEW) {
            throw new BusinessException(
                "APPLICATION_NOT_ELIGIBLE_FOR_OFFER",
                "Only an application in INTERVIEW can receive an offer",
                HttpStatus.CONFLICT,
                Map.of("currentStatus", application.getStatus().name())
            );
        }
        ensureApplicationVersion(application, expectedApplicationVersion);

        OfferEntity offer = OfferEntity.sent(
            UUID.randomUUID(),
            applicationId,
            recruiterId,
            normalized.salary(),
            normalized.startDate(),
            normalized.position(),
            normalized.note(),
            normalized.fileId(),
            normalized.fileUrl(),
            now,
            normalized.expiresAt()
        );
        UUID eventId = UUID.randomUUID();
        String payload = offerSentPayload(
            eventId,
            application,
            recruiterId,
            offer,
            expectedApplicationVersion + 1,
            now
        );

        int applicationChanged = applications.transition(
            applicationId,
            ApplicationStatus.OFFER,
            now,
            expectedApplicationVersion
        );
        if (applicationChanged != 1) {
            throw applicationChangedConcurrently();
        }

        try {
            offers.saveAndFlush(offer);
        } catch (DataIntegrityViolationException exception) {
            if (violatesOfferUniqueConstraint(exception)) {
                throw offerAlreadyExists();
            }
            throw exception;
        }

        history.append(
            applicationId,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            recruiterId,
            normalized.note(),
            now
        );
        outbox.save(ApplicationEventOutboxEntity.pending(
            eventId,
            applicationId,
            topic,
            payload,
            now
        ));
        return OfferResponse.sent(
            offer,
            expectedApplicationVersion + 1
        );
    }

    @Transactional
    public OfferResponse respond(
        UUID offerId,
        UUID candidateId,
        RespondOfferRequest request
    ) {
        OfferEntity offer = findOffer(offerId);
        ApplicationEntity application = findApplication(
            offer.getApplicationId()
        );
        if (!application.getCandidateId().equals(candidateId)) {
            throw new BusinessException(
                "OFFER_ACCESS_DENIED",
                "You cannot respond to this offer",
                HttpStatus.FORBIDDEN
            );
        }

        OfferDecision decision = requireDecision(request.decision());
        String responseNote = normalizeResponseNote(
            decision,
            request.declineReason()
        );
        long expectedOfferVersion = requireVersion(
            request.expectedOfferVersion(),
            "INVALID_OFFER_VERSION",
            "expectedOfferVersion must not be negative"
        );
        long expectedApplicationVersion = requireVersion(
            request.expectedApplicationVersion(),
            "INVALID_APPLICATION_VERSION",
            "expectedApplicationVersion must not be negative"
        );

        Instant now = clock.instant();
        // A lapsed Offer keeps returning OFFER_EXPIRED whether or not the
        // expiry worker has already resolved the row, so the Candidate-facing
        // conflict does not change under the worker.
        if (offer.getStatus() == OfferStatus.EXPIRED) {
            throw offerExpired(offer.getExpiresAt());
        }
        if (offer.getStatus() != OfferStatus.SENT) {
            throw offerAlreadyResponded(offer.getStatus());
        }
        if (!offer.getExpiresAt().isAfter(now)) {
            throw offerExpired(offer.getExpiresAt());
        }
        if (application.getStatus() != ApplicationStatus.OFFER) {
            throw applicationChangedConcurrently();
        }
        if (offer.getVersion() != expectedOfferVersion) {
            throw offerChangedConcurrently();
        }
        ensureApplicationVersion(application, expectedApplicationVersion);

        OfferStatus targetOfferStatus = decision == OfferDecision.ACCEPTED
            ? OfferStatus.ACCEPTED
            : OfferStatus.DECLINED;
        ApplicationStatus targetApplicationStatus =
            decision == OfferDecision.ACCEPTED
                ? ApplicationStatus.HIRED
                : ApplicationStatus.REJECTED;
        long resultingOfferVersion = expectedOfferVersion + 1;
        long resultingApplicationVersion = expectedApplicationVersion + 1;
        UUID eventId = UUID.randomUUID();
        String payload = responsePayload(
            eventId,
            application,
            candidateId,
            offerId,
            targetOfferStatus,
            resultingOfferVersion,
            targetApplicationStatus,
            resultingApplicationVersion,
            now
        );

        int offerChanged = offers.respond(
            offerId,
            targetOfferStatus,
            now,
            responseNote,
            expectedOfferVersion,
            now
        );
        if (offerChanged != 1) {
            throw diagnoseOfferUpdateFailure(offerId, now);
        }

        int applicationChanged = applications.transition(
            application.getId(),
            targetApplicationStatus,
            now,
            expectedApplicationVersion
        );
        if (applicationChanged != 1) {
            throw applicationChangedConcurrently();
        }

        history.append(
            application.getId(),
            ApplicationStatus.OFFER,
            targetApplicationStatus,
            candidateId,
            responseNote,
            now
        );
        outbox.save(ApplicationEventOutboxEntity.pending(
            eventId,
            application.getId(),
            topic,
            payload,
            now
        ));
        return OfferResponse.responded(
            offer,
            targetOfferStatus,
            now,
            responseNote,
            resultingOfferVersion,
            targetApplicationStatus,
            resultingApplicationVersion
        );
    }

    private NormalizedOffer normalize(
        CreateOfferRequest request,
        Instant now
    ) {
        BigDecimal salary = normalizeSalary(request.salary());
        LocalDate startDate = request.startDate();
        if (
            startDate == null ||
            startDate.isBefore(LocalDate.ofInstant(now, clock.getZone()))
        ) {
            throw new BusinessException(
                "INVALID_OFFER_START_DATE",
                "startDate must not be in the past",
                HttpStatus.BAD_REQUEST
            );
        }

        String position = normalizeRequiredText(
            request.position(),
            MAX_POSITION_LENGTH,
            "INVALID_OFFER_POSITION",
            "position is required and must not exceed 200 characters"
        );
        String note = normalizeOptionalText(
            request.note(),
            MAX_NOTE_LENGTH,
            "INVALID_OFFER_NOTE",
            "note must not exceed 2000 characters"
        );
        FileReference file = normalizeFileReference(
            request.fileId(),
            request.fileUrl()
        );
        Instant expiresAt = request.expiresAt();
        if (expiresAt == null || !expiresAt.isAfter(now)) {
            throw new BusinessException(
                "INVALID_OFFER_EXPIRY",
                "expiresAt must be in the future",
                HttpStatus.BAD_REQUEST
            );
        }
        return new NormalizedOffer(
            salary,
            startDate,
            position,
            note,
            file.fileId(),
            file.fileUrl(),
            expiresAt
        );
    }

    private BigDecimal normalizeSalary(BigDecimal salary) {
        if (salary == null || salary.signum() <= 0) {
            throw invalidSalary();
        }
        try {
            BigDecimal normalized = salary.setScale(
                2,
                RoundingMode.UNNECESSARY
            );
            int integerDigits = normalized.precision() - normalized.scale();
            if (integerDigits > MAX_SALARY_INTEGER_DIGITS) {
                throw invalidSalary();
            }
            return normalized;
        } catch (ArithmeticException exception) {
            throw invalidSalary();
        }
    }

    private FileReference normalizeFileReference(
        UUID fileId,
        String rawFileUrl
    ) {
        String fileUrl = normalizeOptionalText(
            rawFileUrl,
            MAX_FILE_URL_LENGTH,
            "INVALID_OFFER_FILE",
            "fileUrl must not exceed 2048 characters"
        );
        if ((fileId == null) != (fileUrl == null)) {
            throw invalidFileReference();
        }
        if (fileUrl == null) {
            return new FileReference(null, null);
        }

        try {
            URI uri = new URI(fileUrl);
            String scheme = uri.getScheme();
            if (
                !uri.isAbsolute() ||
                uri.getHost() == null ||
                !("http".equalsIgnoreCase(scheme) ||
                    "https".equalsIgnoreCase(scheme))
            ) {
                throw invalidFileReference();
            }
        } catch (URISyntaxException exception) {
            throw invalidFileReference();
        }
        return new FileReference(fileId, fileUrl);
    }

    private OfferDecision requireDecision(OfferDecision decision) {
        if (decision == null) {
            throw new BusinessException(
                "INVALID_OFFER_DECISION",
                "decision must be ACCEPTED or DECLINED",
                HttpStatus.BAD_REQUEST
            );
        }
        return decision;
    }

    private String normalizeResponseNote(
        OfferDecision decision,
        String rawReason
    ) {
        String reason = normalizeOptionalText(
            rawReason,
            MAX_NOTE_LENGTH,
            "INVALID_DECLINE_REASON",
            "declineReason must not exceed 2000 characters"
        );
        if (decision == OfferDecision.DECLINED && reason == null) {
            throw new BusinessException(
                "DECLINE_REASON_REQUIRED",
                "declineReason is required when declining an offer",
                HttpStatus.BAD_REQUEST
            );
        }
        return decision == OfferDecision.DECLINED ? reason : null;
    }

    private String normalizeRequiredText(
        String value,
        int maxLength,
        String code,
        String message
    ) {
        String normalized = value == null ? null : value.strip();
        if (
            normalized == null ||
            normalized.isEmpty() ||
            normalized.length() > maxLength
        ) {
            throw new BusinessException(
                code,
                message,
                HttpStatus.BAD_REQUEST
            );
        }
        return normalized;
    }

    private String normalizeOptionalText(
        String value,
        int maxLength,
        String code,
        String message
    ) {
        if (value == null) return null;
        String normalized = value.strip();
        if (normalized.isEmpty()) return null;
        if (normalized.length() > maxLength) {
            throw new BusinessException(
                code,
                message,
                HttpStatus.BAD_REQUEST
            );
        }
        return normalized;
    }

    private long requireVersion(
        Long version,
        String code,
        String message
    ) {
        if (version == null || version < 0) {
            throw new BusinessException(code, message, HttpStatus.BAD_REQUEST);
        }
        return version;
    }

    private void authorizeRecruiter(
        ApplicationEntity application,
        UUID recruiterId,
        String authorization
    ) {
        RecruiterCompanyMembership membership =
            companies.getRecruiterMembership(recruiterId, authorization);
        if (
            !membership.canManageAllCompanyApplications() ||
            !application.getCompanyId().equals(membership.companyId())
        ) {
            throw new BusinessException(
                "APPLICATION_ACCESS_DENIED",
                "You cannot send an offer for this application",
                HttpStatus.FORBIDDEN
            );
        }
    }

    private void ensureApplicationVersion(
        ApplicationEntity application,
        long expectedVersion
    ) {
        if (application.getVersion() != expectedVersion) {
            throw applicationChangedConcurrently();
        }
    }

    private ApplicationEntity findApplication(UUID applicationId) {
        return applications.findById(applicationId).orElseThrow(() ->
            new BusinessException(
                "APPLICATION_NOT_FOUND",
                "Application was not found",
                HttpStatus.NOT_FOUND
            )
        );
    }

    private OfferEntity findOffer(UUID offerId) {
        return offers.findById(offerId).orElseThrow(() ->
            new BusinessException(
                "OFFER_NOT_FOUND",
                "Offer was not found",
                HttpStatus.NOT_FOUND
            )
        );
    }

    private BusinessException diagnoseOfferUpdateFailure(
        UUID offerId,
        Instant now
    ) {
        OfferEntity current = offers.findById(offerId).orElseThrow(() ->
            new BusinessException(
                "OFFER_NOT_FOUND",
                "Offer was not found",
                HttpStatus.NOT_FOUND
            )
        );
        if (current.getStatus() == OfferStatus.EXPIRED) {
            return offerExpired(current.getExpiresAt());
        }
        if (current.getStatus() != OfferStatus.SENT) {
            return offerAlreadyResponded(current.getStatus());
        }
        if (!current.getExpiresAt().isAfter(now)) {
            return offerExpired(current.getExpiresAt());
        }
        return offerChangedConcurrently();
    }

    private boolean violatesOfferUniqueConstraint(Throwable exception) {
        Throwable cause = exception;
        while (cause != null) {
            if (
                cause instanceof ConstraintViolationException violation &&
                OFFER_UNIQUE_CONSTRAINT.equals(violation.getConstraintName())
            ) {
                return true;
            }
            Throwable next = cause.getCause();
            cause = next == cause ? null : next;
        }
        return false;
    }

    private BusinessException invalidSalary() {
        return new BusinessException(
            "INVALID_OFFER_SALARY",
            "salary must be greater than zero with at most 2 decimal places",
            HttpStatus.BAD_REQUEST
        );
    }

    private BusinessException invalidFileReference() {
        return new BusinessException(
            "INVALID_OFFER_FILE",
            "fileId and an absolute HTTP(S) fileUrl must be provided together",
            HttpStatus.BAD_REQUEST
        );
    }

    private BusinessException offerAlreadyExists() {
        return new BusinessException(
            "OFFER_ALREADY_EXISTS",
            "An offer already exists for this application",
            HttpStatus.CONFLICT
        );
    }

    private BusinessException offerAlreadyResponded(OfferStatus status) {
        return new BusinessException(
            "OFFER_ALREADY_RESPONDED",
            "This offer has already been responded to",
            HttpStatus.CONFLICT,
            Map.of("currentStatus", status.name())
        );
    }

    private BusinessException offerExpired(Instant expiresAt) {
        return new BusinessException(
            "OFFER_EXPIRED",
            "This offer has expired",
            HttpStatus.CONFLICT,
            Map.of("expiresAt", expiresAt)
        );
    }

    private BusinessException offerChangedConcurrently() {
        return new BusinessException(
            "OFFER_CHANGED_CONCURRENTLY",
            "Offer changed concurrently; reload and try again",
            HttpStatus.CONFLICT
        );
    }

    private BusinessException applicationChangedConcurrently() {
        return new BusinessException(
            "APPLICATION_CHANGED_CONCURRENTLY",
            "Application changed concurrently; reload and try again",
            HttpStatus.CONFLICT
        );
    }

    private String offerSentPayload(
        UUID eventId,
        ApplicationEntity application,
        UUID actorId,
        OfferEntity offer,
        long aggregateVersion,
        Instant occurredAt
    ) {
        Map<String, Object> event = baseEvent(
            eventId,
            ApplicationEventV1.Action.OFFER_SENT,
            application,
            actorId,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            aggregateVersion,
            occurredAt
        );
        event.put("offer_id", offer.getId());
        event.put("offer_status", OfferStatus.SENT);
        event.put("offer_version", offer.getVersion());
        return serializeEvent(event);
    }

    private String responsePayload(
        UUID eventId,
        ApplicationEntity application,
        UUID actorId,
        UUID offerId,
        OfferStatus offerStatus,
        long offerVersion,
        ApplicationStatus applicationStatus,
        long aggregateVersion,
        Instant occurredAt
    ) {
        Map<String, Object> event = baseEvent(
            eventId,
            ApplicationEventV1.Action.STATUS_CHANGED,
            application,
            actorId,
            ApplicationStatus.OFFER,
            applicationStatus,
            aggregateVersion,
            occurredAt
        );
        event.put("offer_id", offerId);
        event.put("offer_status", offerStatus);
        event.put("offer_version", offerVersion);
        return serializeEvent(event);
    }

    private Map<String, Object> baseEvent(
        UUID eventId,
        ApplicationEventV1.Action action,
        ApplicationEntity application,
        UUID actorId,
        ApplicationStatus fromStatus,
        ApplicationStatus toStatus,
        long aggregateVersion,
        Instant occurredAt
    ) {
        return ApplicationEventV1.base(
            eventId,
            action,
            application,
            actorId,
            fromStatus,
            toStatus,
            aggregateVersion,
            occurredAt
        );
    }

    private String serializeEvent(Map<String, Object> event) {
        try {
            return objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                "Cannot serialize application event",
                exception
            );
        }
    }

    private record FileReference(UUID fileId, String fileUrl) {}

    private record NormalizedOffer(
        BigDecimal salary,
        LocalDate startDate,
        String position,
        String note,
        UUID fileId,
        String fileUrl,
        Instant expiresAt
    ) {}
}
