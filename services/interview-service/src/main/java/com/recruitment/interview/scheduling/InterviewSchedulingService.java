package com.recruitment.interview.scheduling;

import com.recruitment.interview.api.BusinessException;
import com.recruitment.interview.client.ApplicationAuthorizationContext;
import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.repository.InterviewRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.SQLException;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class InterviewSchedulingService {
    private static final List<Integer> DURATIONS = List.of(30, 45, 60);

    private final ApplicationClient applications;
    private final InterviewRepository interviews;
    private final InterviewSchedulingTransaction transaction;
    private final Clock clock;

    public InterviewSchedulingService(
        ApplicationClient applications,
        InterviewRepository interviews,
        InterviewSchedulingTransaction transaction,
        Clock clock
    ) {
        this.applications = applications;
        this.interviews = interviews;
        this.transaction = transaction;
        this.clock = clock;
    }

    ScheduleInterviewResult schedule(
        UUID recruiterId,
        String accessToken,
        CreateInterviewRequest request
    ) {
        ValidatedSchedule schedule = validate(recruiterId, request);
        Optional<InterviewEntity> replay = interviews
            .findByScheduledByAndRequestId(recruiterId, request.requestId());
        if (replay.isPresent()) {
            return replay(replay.get(), schedule.requestHash());
        }

        ApplicationAuthorizationContext context =
            applications.authorizeScheduling(
                request.applicationId(),
                "Bearer " + accessToken
            );
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        InterviewEntity interview = InterviewEntity.schedule(
            UUID.randomUUID(),
            context.applicationId(),
            context.applicationVersion(),
            context.status(),
            context.companyId(),
            context.jobId(),
            context.candidateId(),
            recruiterId,
            request.requestId(),
            schedule.requestHash(),
            request.roundNumber(),
            schedule.start(),
            schedule.end(),
            schedule.timeZone(),
            request.durationMinutes(),
            request.mode(),
            schedule.location(),
            schedule.notes(),
            now
        );

        try {
            return new ScheduleInterviewResult(
                InterviewResponse.from(createWithDeadlockRetry(interview)),
                false
            );
        } catch (DataIntegrityViolationException exception) {
            Optional<InterviewEntity> concurrentReplay = interviews
                .findByScheduledByAndRequestId(
                    recruiterId,
                    request.requestId()
                );
            if (concurrentReplay.isPresent()) {
                return replay(
                    concurrentReplay.get(),
                    schedule.requestHash()
                );
            }
            throw mapConstraint(exception);
        }
    }

    private InterviewEntity createWithDeadlockRetry(
        InterviewEntity interview
    ) {
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                return transaction.create(interview);
            } catch (CannotAcquireLockException exception) {
                if (attempt == 2) {
                    throw conflict(
                        "INTERVIEW_SCHEDULE_CONFLICT",
                        "Concurrent scheduling prevented this interview"
                    );
                }
            }
        }
        throw new IllegalStateException("Unreachable scheduling retry state");
    }

    private ValidatedSchedule validate(
        UUID recruiterId,
        CreateInterviewRequest request
    ) {
        if (!DURATIONS.contains(request.durationMinutes())) {
            throw invalid(
                "durationMinutes",
                "Duration must be one of 30, 45 or 60 minutes"
            );
        }
        if (request.mode() == InterviewMode.ONLINE) {
            throw new BusinessException(
                "INTERVIEW_ONLINE_NOT_READY",
                "Online interviews will be enabled with the Jitsi lifecycle",
                HttpStatus.CONFLICT
            );
        }
        String location = normalize(request.location(), "location", true);
        if (location == null) {
            throw invalid(
                "location",
                "Location is required for an offline interview"
            );
        }
        String notes = normalize(request.notes(), "notes", false);
        String timeZone = normalize(request.timeZone(), "timeZone", true);

        OffsetDateTime requestedStart = request.scheduledStart();
        if (requestedStart.getNano() % 1_000_000 != 0) {
            throw invalid(
                "scheduledStart",
                "Scheduled time precision must not be smaller than one millisecond"
            );
        }
        ZoneId zone;
        try {
            zone = ZoneId.of(timeZone);
        } catch (DateTimeException exception) {
            throw invalid("timeZone", "Time zone must be a valid IANA zone");
        }
        List<ZoneOffset> validOffsets = zone.getRules().getValidOffsets(
            requestedStart.toLocalDateTime()
        );
        if (!validOffsets.contains(requestedStart.getOffset())) {
            throw invalid(
                "scheduledStart",
                "Scheduled offset does not exist in the supplied time zone"
            );
        }
        Instant start = requestedStart.toInstant();
        if (!start.isAfter(clock.instant())) {
            throw invalid(
                "scheduledStart",
                "Interview must be scheduled in the future"
            );
        }
        Instant end = start.plus(request.durationMinutes(), ChronoUnit.MINUTES);
        String requestHash = hash(
            recruiterId,
            request,
            start,
            timeZone,
            location,
            notes
        );
        return new ValidatedSchedule(
            start,
            end,
            timeZone,
            location,
            notes,
            requestHash
        );
    }

    private ScheduleInterviewResult replay(
        InterviewEntity existing,
        String expectedHash
    ) {
        if (!MessageDigest.isEqual(
            existing.getRequestHash().getBytes(StandardCharsets.US_ASCII),
            expectedHash.getBytes(StandardCharsets.US_ASCII)
        )) {
            throw new BusinessException(
                "INTERVIEW_IDEMPOTENCY_CONFLICT",
                "requestId was already used with a different payload",
                HttpStatus.CONFLICT
            );
        }
        return new ScheduleInterviewResult(
            InterviewResponse.from(existing),
            true
        );
    }

    private String normalize(
        String value,
        String field,
        boolean required
    ) {
        if (value == null) {
            if (required) throw invalid(field, field + " is required");
            return null;
        }
        String normalized = value.trim();
        if (normalized.isEmpty()) {
            if (required) throw invalid(field, field + " is required");
            return null;
        }
        if (normalized.chars().anyMatch(Character::isISOControl)) {
            throw invalid(field, field + " must not contain control characters");
        }
        return normalized;
    }

    private String hash(
        UUID recruiterId,
        CreateInterviewRequest request,
        Instant start,
        String timeZone,
        String location,
        String notes
    ) {
        String canonical = String.join("\n",
            recruiterId.toString(),
            request.applicationId().toString(),
            Integer.toString(request.roundNumber()),
            start.toString(),
            timeZone,
            Integer.toString(request.durationMinutes()),
            request.mode().name(),
            location,
            notes == null ? "" : notes
        );
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                canonical.getBytes(StandardCharsets.UTF_8)
            );
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private BusinessException mapConstraint(
        DataIntegrityViolationException exception
    ) {
        String constraint = null;
        String sqlState = null;
        Throwable current = exception;
        while (current != null) {
            if (current instanceof ConstraintViolationException violation) {
                constraint = violation.getConstraintName();
                sqlState = violation.getSQLState();
            } else if (current instanceof SQLException sqlException) {
                sqlState = sqlException.getSQLState();
            }
            current = current.getCause();
        }
        String source = constraint == null
            ? exception.getMessage()
            : constraint;
        if (source != null && source.contains("candidate_schedule")) {
            return conflict(
                "INTERVIEW_CANDIDATE_CONFLICT",
                "Candidate already has an overlapping interview"
            );
        }
        if (source != null && source.contains("interviewer_schedule")) {
            return conflict(
                "INTERVIEW_INTERVIEWER_CONFLICT",
                "Interviewer already has an overlapping interview"
            );
        }
        if (source != null && source.contains("active_application_round")) {
            return conflict(
                "INTERVIEW_ROUND_ALREADY_SCHEDULED",
                "This application round already has an active interview"
            );
        }
        if ("23P01".equals(sqlState)) {
            return conflict(
                "INTERVIEW_SCHEDULE_CONFLICT",
                "Interview overlaps an active schedule"
            );
        }
        return conflict(
            "INTERVIEW_CONSTRAINT_VIOLATION",
            "Interview violates a scheduling constraint"
        );
    }

    private BusinessException invalid(String field, String message) {
        return new BusinessException(
            "VALIDATION_ERROR",
            "Request validation failed",
            HttpStatus.BAD_REQUEST,
            Map.of(field, message)
        );
    }

    private BusinessException conflict(String code, String message) {
        return new BusinessException(code, message, HttpStatus.CONFLICT);
    }

    private record ValidatedSchedule(
        Instant start,
        Instant end,
        String timeZone,
        String location,
        String notes,
        String requestHash
    ) {}
}
