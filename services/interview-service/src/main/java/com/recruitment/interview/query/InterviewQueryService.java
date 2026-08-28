package com.recruitment.interview.query;

import com.recruitment.interview.api.BusinessException;
import com.recruitment.interview.client.ApplicationAuthorizationContext;
import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.client.CompanyMembershipClient;
import com.recruitment.interview.client.RecruiterCompanyMembership;
import com.recruitment.interview.domain.InterviewStatus;
import com.recruitment.interview.query.InterviewCursorCodec.PageCursor;
import com.recruitment.interview.query.InterviewCursorCodec.SlotCursor;
import com.recruitment.interview.query.InterviewQueryModels.Availability;
import com.recruitment.interview.query.InterviewQueryModels.Item;
import com.recruitment.interview.query.InterviewQueryModels.Page;
import com.recruitment.interview.query.InterviewQueryModels.Slot;
import com.recruitment.interview.query.InterviewReadRepository.BusyInterval;
import com.recruitment.interview.query.InterviewReadRepository.Filters;
import com.recruitment.interview.query.InterviewReadRepository.InterviewReadRow;
import com.recruitment.interview.query.InterviewReadRepository.PagePosition;
import com.recruitment.interview.query.InterviewReadRepository.Visibility;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class InterviewQueryService {
    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;
    private static final Duration MAX_CALENDAR_RANGE = Duration.ofDays(42);
    private static final Duration MAX_AVAILABILITY_RANGE =
        Duration.ofHours(26);
    private static final Duration MAX_AVAILABILITY_HORIZON =
        Duration.ofDays(92);
    private static final Duration SLOT_STEP = Duration.ofMinutes(15);
    private static final List<Integer> DURATIONS = List.of(30, 45, 60);

    private final InterviewReadRepository interviews;
    private final InterviewCursorCodec cursors;
    private final CompanyMembershipClient companies;
    private final ApplicationClient applications;
    private final Clock clock;

    public InterviewQueryService(
        InterviewReadRepository interviews,
        InterviewCursorCodec cursors,
        CompanyMembershipClient companies,
        ApplicationClient applications,
        Clock clock
    ) {
        this.interviews = interviews;
        this.cursors = cursors;
        this.companies = companies;
        this.applications = applications;
        this.clock = clock;
    }

    public Item detail(
        Viewer viewer,
        String accessToken,
        String interviewId
    ) {
        UUID id = requiredUuid(interviewId, "interviewId");
        Access access = access(viewer, accessToken, false);
        InterviewReadRow row = interviews.findDetail(id, access.visibility())
            .orElseThrow(this::notFound);
        return item(row, viewer.role(), true);
    }

    public Page history(
        Viewer viewer,
        String accessToken,
        HistoryQuery query
    ) {
        UUID applicationId = optionalUuid(
            query.applicationId(),
            "applicationId"
        );
        UUID jobId = optionalUuid(query.jobId(), "jobId");
        UUID candidateId = optionalUuid(query.candidateId(), "candidateId");
        UUID interviewerId = optionalUuid(
            query.interviewerId(),
            "interviewerId"
        );
        List<InterviewStatus> statuses = statuses(query.statuses());
        int limit = limit(query.limit());
        if (viewer.role() == ViewerRole.CANDIDATE) {
            if (
                applicationId == null ||
                jobId != null ||
                candidateId != null ||
                interviewerId != null
            ) {
                throw invalid(
                    "query",
                    "Candidate history requires only applicationId filters"
                );
            }
        } else if (
            applicationId == null &&
            jobId == null &&
            candidateId == null &&
            interviewerId == null
        ) {
            throw invalid(
                "query",
                "Recruiter history requires at least one identity filter"
            );
        }

        Access access = access(viewer, accessToken, false);
        String scope = scope(
            "history",
            viewer,
            access,
            "DESC",
            limit,
            applicationId,
            jobId,
            candidateId,
            interviewerId,
            statusKey(statuses),
            null,
            null,
            null
        );
        PageCursor decoded = decodePage(query.cursor(), scope);
        Instant asOf = decoded == null ? now() : decoded.asOf();
        Filters filters = new Filters(
            applicationId,
            jobId,
            candidateId,
            interviewerId,
            statuses,
            null,
            null,
            null,
            null
        );
        return page(
            viewer,
            access.visibility(),
            filters,
            decoded,
            false,
            limit,
            asOf,
            scope
        );
    }

    public Page my(
        Viewer viewer,
        String accessToken,
        MyQuery query
    ) {
        Period period = parsePeriod(query.period());
        List<InterviewStatus> statuses = statuses(query.statuses());
        int limit = limit(query.limit());
        TimeRange range = null;
        if (period == Period.RANGE) {
            range = range(
                query.from(),
                query.to(),
                MAX_CALENDAR_RANGE,
                "from",
                "to"
            );
        } else if (query.from() != null || query.to() != null) {
            throw invalid(
                "period",
                "from and to are only supported for period RANGE"
            );
        }

        Access access = access(viewer, accessToken, true);
        boolean ascending =
            period == Period.UPCOMING || period == Period.RANGE;
        String scope = scope(
            "my",
            viewer,
            access,
            ascending ? "ASC" : "DESC",
            limit,
            period,
            statusKey(statuses),
            range == null ? null : range.from(),
            range == null ? null : range.to(),
            null,
            null,
            null,
            null
        );
        PageCursor decoded = decodePage(query.cursor(), scope);
        Instant asOf = decoded == null ? now() : decoded.asOf();
        Filters filters = new Filters(
            null,
            null,
            null,
            null,
            statuses,
            range == null ? null : range.from(),
            range == null ? null : range.to(),
            period == Period.UPCOMING ? asOf : null,
            period == Period.PAST ? asOf : null
        );
        return page(
            viewer,
            access.visibility(),
            filters,
            decoded,
            ascending,
            limit,
            asOf,
            scope
        );
    }

    public Page calendar(
        Viewer viewer,
        String accessToken,
        CalendarQuery query
    ) {
        if (viewer.role() != ViewerRole.RECRUITER) throw denied();
        TimeRange range = range(
            query.from(),
            query.to(),
            MAX_CALENDAR_RANGE,
            "from",
            "to"
        );
        UUID jobId = optionalUuid(query.jobId(), "jobId");
        UUID candidateId = optionalUuid(query.candidateId(), "candidateId");
        UUID interviewerId = optionalUuid(
            query.interviewerId(),
            "interviewerId"
        );
        List<InterviewStatus> statuses = statuses(query.statuses());
        int limit = limit(query.limit());
        Access access = access(viewer, accessToken, false);
        String scope = scope(
            "calendar",
            viewer,
            access,
            "ASC",
            limit,
            range.from(),
            range.to(),
            jobId,
            candidateId,
            interviewerId,
            statusKey(statuses),
            null,
            null
        );
        PageCursor decoded = decodePage(query.cursor(), scope);
        Instant asOf = decoded == null ? now() : decoded.asOf();
        Filters filters = new Filters(
            null,
            jobId,
            candidateId,
            interviewerId,
            statuses,
            range.from(),
            range.to(),
            null,
            null
        );
        return page(
            viewer,
            access.visibility(),
            filters,
            decoded,
            true,
            limit,
            asOf,
            scope
        );
    }

    public Availability availability(
        Viewer viewer,
        String accessToken,
        AvailabilityQuery query
    ) {
        if (viewer.role() != ViewerRole.RECRUITER) throw denied();
        UUID applicationId = requiredUuid(
            query.applicationId(),
            "applicationId"
        );
        int durationMinutes = integer(
            query.durationMinutes(),
            "durationMinutes"
        );
        if (!DURATIONS.contains(durationMinutes)) {
            throw invalid(
                "durationMinutes",
                "Duration must be one of 30, 45 or 60 minutes"
            );
        }
        ZoneId timeZone = timeZone(query.timeZone());
        OffsetRange requested = offsetRange(
            query.from(),
            query.to(),
            timeZone
        );
        int limit = limit(query.limit());
        Instant current = now();
        if (
            !requested.to().isAfter(current) ||
            requested.from().isAfter(
                current.plus(MAX_AVAILABILITY_HORIZON)
            ) ||
            requested.to().isAfter(
                current.plus(MAX_AVAILABILITY_HORIZON)
            )
        ) {
            throw invalid(
                "from",
                "Availability window must include a future time within 92 days"
            );
        }

        ApplicationAuthorizationContext context =
            applications.authorizeScheduling(
                applicationId,
                "Bearer " + accessToken
            );
        String scope = String.join(
            "\n",
            "availability",
            viewer.role().name(),
            viewer.id().toString(),
            context.companyId().toString(),
            context.candidateId().toString(),
            applicationId.toString(),
            requested.from().toString(),
            requested.to().toString(),
            timeZone.getId(),
            Integer.toString(durationMinutes),
            Integer.toString(limit)
        );
        SlotCursor decoded = decodeSlot(query.cursor(), scope);
        Instant asOf = decoded == null ? current : decoded.asOf();
        List<BusyInterval> busy = merge(interviews.findBusyIntervals(
            viewer.id(),
            context.candidateId(),
            requested.from(),
            requested.to()
        ));
        Instant lowerBound = current.isAfter(requested.from())
            ? current
            : requested.from();
        if (decoded != null) {
            Instant afterCursor = decoded.position().plus(SLOT_STEP);
            if (afterCursor.isAfter(lowerBound)) {
                lowerBound = afterCursor;
            }
        }
        Instant first = alignToGrid(requested.from(), lowerBound);

        List<Slot> available = new ArrayList<>();
        Duration interviewDuration = Duration.ofMinutes(durationMinutes);
        Instant candidate = first;
        while (
            !candidate.plus(interviewDuration).isAfter(requested.to()) &&
            available.size() <= limit
        ) {
            Instant end = candidate.plus(interviewDuration);
            if (free(candidate, end, busy)) {
                available.add(new Slot(candidate, end));
            }
            candidate = candidate.plus(SLOT_STEP);
        }

        boolean hasMore = available.size() > limit;
        List<Slot> page = hasMore
            ? List.copyOf(available.subList(0, limit))
            : List.copyOf(available);
        String nextCursor = null;
        if (hasMore && !page.isEmpty()) {
            nextCursor = cursors.encodeSlot(
                scope,
                asOf,
                page.get(page.size() - 1).start()
            );
        }
        return new Availability(
            applicationId,
            viewer.id(),
            requested.from(),
            requested.to(),
            timeZone.getId(),
            durationMinutes,
            (int) SLOT_STEP.toMinutes(),
            page,
            nextCursor,
            asOf
        );
    }

    private Page page(
        Viewer viewer,
        Visibility visibility,
        Filters filters,
        PageCursor decoded,
        boolean ascending,
        int limit,
        Instant asOf,
        String scope
    ) {
        PagePosition position = decoded == null
            ? null
            : new PagePosition(decoded.position(), decoded.id());
        List<InterviewReadRow> rows = interviews.findPage(
            visibility,
            filters,
            position,
            ascending,
            limit + 1,
            asOf
        );
        boolean hasMore = rows.size() > limit;
        List<InterviewReadRow> visible = hasMore
            ? rows.subList(0, limit)
            : rows;
        List<Item> items = visible.stream()
            .map(row -> item(row, viewer.role(), false))
            .toList();
        String nextCursor = null;
        if (hasMore && !visible.isEmpty()) {
            InterviewReadRow last = visible.get(visible.size() - 1);
            nextCursor = cursors.encodePage(
                scope,
                asOf,
                last.scheduledStart(),
                last.id()
            );
        }
        return new Page(items, nextCursor, asOf);
    }

    private Access access(
        Viewer viewer,
        String accessToken,
        boolean selfOnly
    ) {
        if (viewer.role() == ViewerRole.CANDIDATE) {
            return new Access(
                Visibility.candidate(viewer.id()),
                null,
                null
            );
        }
        RecruiterCompanyMembership membership = companies.resolve(
            viewer.id(),
            accessToken
        );
        Visibility visibility = selfOnly
            ? Visibility.interviewer(membership.companyId(), viewer.id())
            : Visibility.company(membership.companyId());
        return new Access(
            visibility,
            membership.companyId(),
            membership.memberRole().name()
        );
    }

    private Item item(
        InterviewReadRow row,
        ViewerRole role,
        boolean detail
    ) {
        boolean recruiter = role == ViewerRole.RECRUITER;
        return new Item(
            row.id(),
            row.applicationId(),
            recruiter ? row.companyId() : null,
            row.jobId(),
            recruiter ? row.candidateId() : null,
            recruiter ? row.interviewerId() : null,
            recruiter && detail ? row.scheduledBy() : null,
            row.roundNumber(),
            row.scheduleRevision(),
            row.scheduledStart(),
            row.scheduledEnd(),
            row.timeZone(),
            row.durationMinutes(),
            row.mode(),
            row.location(),
            recruiter && detail ? row.notes() : null,
            row.status(),
            recruiter && detail ? row.createdAt() : null,
            recruiter && detail ? row.updatedAt() : null,
            row.version()
        );
    }

    private List<BusyInterval> merge(List<BusyInterval> source) {
        if (source.isEmpty()) return List.of();
        List<BusyInterval> ordered = source.stream()
            .sorted(Comparator.comparing(BusyInterval::start)
                .thenComparing(BusyInterval::end))
            .toList();
        List<BusyInterval> merged = new ArrayList<>();
        BusyInterval current = ordered.get(0);
        for (int index = 1; index < ordered.size(); index++) {
            BusyInterval next = ordered.get(index);
            if (!next.start().isAfter(current.end())) {
                current = new BusyInterval(
                    current.start(),
                    current.end().isAfter(next.end())
                        ? current.end()
                        : next.end()
                );
            } else {
                merged.add(current);
                current = next;
            }
        }
        merged.add(current);
        return List.copyOf(merged);
    }

    private boolean free(
        Instant start,
        Instant end,
        List<BusyInterval> busy
    ) {
        return busy.stream().noneMatch(interval ->
            start.isBefore(interval.end()) && end.isAfter(interval.start())
        );
    }

    private Instant alignToGrid(Instant anchor, Instant lowerBound) {
        if (!lowerBound.isAfter(anchor)) return anchor;
        long step = SLOT_STEP.toMillis();
        long delta = lowerBound.toEpochMilli() - anchor.toEpochMilli();
        long steps = Math.floorDiv(delta + step - 1, step);
        return anchor.plusMillis(Math.multiplyExact(steps, step));
    }

    private TimeRange range(
        String from,
        String to,
        Duration maximum,
        String fromField,
        String toField
    ) {
        Instant start = offset(from, fromField).toInstant();
        Instant end = offset(to, toField).toInstant();
        if (
            !end.isAfter(start) ||
            Duration.between(start, end).compareTo(maximum) > 0
        ) {
            throw invalid(
                fromField,
                "Time range is invalid or exceeds the supported maximum"
            );
        }
        return new TimeRange(start, end);
    }

    private OffsetRange offsetRange(
        String from,
        String to,
        ZoneId zone
    ) {
        OffsetDateTime start = offset(from, "from");
        OffsetDateTime end = offset(to, "to");
        requireOffsetInZone(start, zone, "from");
        requireOffsetInZone(end, zone, "to");
        Instant startInstant = start.toInstant();
        Instant endInstant = end.toInstant();
        if (
            !endInstant.isAfter(startInstant) ||
            Duration.between(startInstant, endInstant)
                .compareTo(MAX_AVAILABILITY_RANGE) > 0
        ) {
            throw invalid(
                "from",
                "Availability range must be positive and at most 26 hours"
            );
        }
        return new OffsetRange(startInstant, endInstant);
    }

    private void requireOffsetInZone(
        OffsetDateTime value,
        ZoneId zone,
        String field
    ) {
        List<ZoneOffset> valid = zone.getRules().getValidOffsets(
            value.toLocalDateTime()
        );
        if (!valid.contains(value.getOffset())) {
            throw invalid(
                field,
                "Timestamp offset does not exist in the supplied time zone"
            );
        }
    }

    private OffsetDateTime offset(String value, String field) {
        String normalized = requiredText(value, field, 80);
        try {
            OffsetDateTime parsed = OffsetDateTime.parse(normalized);
            if (parsed.getNano() % 1_000_000 != 0) {
                throw invalid(
                    field,
                    "Timestamp precision must not be smaller than one millisecond"
                );
            }
            return parsed;
        } catch (BusinessException exception) {
            throw exception;
        } catch (DateTimeException exception) {
            throw invalid(field, "Timestamp must include a valid UTC offset");
        }
    }

    private ZoneId timeZone(String value) {
        String normalized = requiredText(value, "timeZone", 100);
        if (!ZoneId.getAvailableZoneIds().contains(normalized)) {
            throw invalid("timeZone", "Time zone must be a valid IANA zone");
        }
        try {
            return ZoneId.of(normalized);
        } catch (DateTimeException exception) {
            throw invalid("timeZone", "Time zone must be a valid IANA zone");
        }
    }

    private UUID requiredUuid(String value, String field) {
        String normalized = requiredText(value, field, 36);
        try {
            UUID parsed = UUID.fromString(normalized);
            if (
                parsed.version() != 4 ||
                parsed.variant() != 2 ||
                !parsed.toString().equals(normalized)
            ) {
                throw invalid(field, field + " must be a canonical UUIDv4");
            }
            return parsed;
        } catch (BusinessException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw invalid(field, field + " must be a canonical UUIDv4");
        }
    }

    private UUID optionalUuid(String value, String field) {
        return value == null ? null : requiredUuid(value, field);
    }

    private String requiredText(
        String value,
        String field,
        int maxLength
    ) {
        if (
            value == null ||
            value.isEmpty() ||
            value.length() > maxLength ||
            !value.equals(value.trim()) ||
            value.chars().anyMatch(Character::isISOControl)
        ) {
            throw invalid(field, field + " has an invalid format");
        }
        return value;
    }

    private int limit(String value) {
        if (value == null) return DEFAULT_LIMIT;
        int parsed = integer(value, "limit");
        if (parsed < 1 || parsed > MAX_LIMIT) {
            throw invalid("limit", "limit must be between 1 and 50");
        }
        return parsed;
    }

    private int integer(String value, String field) {
        String normalized = requiredText(value, field, 3);
        if (!normalized.matches("[1-9][0-9]{0,2}")) {
            throw invalid(field, field + " must be a positive integer");
        }
        try {
            return Integer.parseInt(normalized);
        } catch (NumberFormatException exception) {
            throw invalid(field, field + " must be a positive integer");
        }
    }

    private List<InterviewStatus> statuses(List<String> values) {
        if (values == null || values.isEmpty()) return List.of();
        if (values.size() > InterviewStatus.values().length) {
            throw invalid("status", "Too many status filters");
        }
        List<InterviewStatus> parsed = new ArrayList<>();
        for (String value : values) {
            String normalized = requiredText(value, "status", 30);
            InterviewStatus status;
            try {
                status = InterviewStatus.valueOf(normalized);
            } catch (IllegalArgumentException exception) {
                throw invalid("status", "Interview status is invalid");
            }
            if (parsed.contains(status)) {
                throw invalid("status", "Duplicate status filters are invalid");
            }
            parsed.add(status);
        }
        return parsed.stream().sorted().toList();
    }

    private Period parsePeriod(String value) {
        if (value == null) return Period.UPCOMING;
        String normalized = requiredText(value, "period", 10);
        try {
            return Period.valueOf(normalized);
        } catch (IllegalArgumentException exception) {
            throw invalid(
                "period",
                "period must be UPCOMING, PAST, ALL or RANGE"
            );
        }
    }

    private PageCursor decodePage(String cursor, String scope) {
        return cursor == null ? null : cursors.decodePage(cursor, scope);
    }

    private SlotCursor decodeSlot(String cursor, String scope) {
        return cursor == null ? null : cursors.decodeSlot(cursor, scope);
    }

    private String statusKey(List<InterviewStatus> statuses) {
        return statuses.isEmpty()
            ? "-"
            : statuses.stream().map(Enum::name)
                .reduce((left, right) -> left + "," + right)
                .orElse("-");
    }

    private String scope(
        String endpoint,
        Viewer viewer,
        Access access,
        Object... values
    ) {
        List<String> components = new ArrayList<>();
        components.add(endpoint);
        components.add(viewer.role().name());
        components.add(viewer.id().toString());
        components.add(
            access.companyId() == null
                ? "-"
                : access.companyId().toString()
        );
        components.add(
            access.memberRole() == null ? "-" : access.memberRole()
        );
        for (Object value : values) {
            components.add(value == null ? "-" : value.toString());
        }
        return String.join("\n", components);
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MILLIS);
    }

    private BusinessException invalid(String field, String message) {
        return new BusinessException(
            "VALIDATION_ERROR",
            "Request validation failed",
            HttpStatus.BAD_REQUEST,
            Map.of(field, message)
        );
    }

    private BusinessException denied() {
        return new BusinessException(
            "INTERVIEW_ACCESS_DENIED",
            "This interview resource is not available to the caller",
            HttpStatus.FORBIDDEN
        );
    }

    private BusinessException notFound() {
        return new BusinessException(
            "INTERVIEW_NOT_FOUND",
            "Interview was not found",
            HttpStatus.NOT_FOUND
        );
    }

    public enum ViewerRole {
        CANDIDATE,
        RECRUITER
    }

    public enum Period {
        UPCOMING,
        PAST,
        ALL,
        RANGE
    }

    public record Viewer(UUID id, ViewerRole role) {}

    public record HistoryQuery(
        String applicationId,
        String jobId,
        String candidateId,
        String interviewerId,
        List<String> statuses,
        String limit,
        String cursor
    ) {}

    public record MyQuery(
        String period,
        String from,
        String to,
        List<String> statuses,
        String limit,
        String cursor
    ) {}

    public record CalendarQuery(
        String from,
        String to,
        String jobId,
        String candidateId,
        String interviewerId,
        List<String> statuses,
        String limit,
        String cursor
    ) {}

    public record AvailabilityQuery(
        String applicationId,
        String from,
        String to,
        String timeZone,
        String durationMinutes,
        String limit,
        String cursor
    ) {}

    private record Access(
        Visibility visibility,
        UUID companyId,
        String memberRole
    ) {}

    private record TimeRange(Instant from, Instant to) {}

    private record OffsetRange(Instant from, Instant to) {}
}
