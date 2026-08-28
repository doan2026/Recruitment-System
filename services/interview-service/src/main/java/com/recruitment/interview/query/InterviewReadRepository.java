package com.recruitment.interview.query;

import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.domain.InterviewStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class InterviewReadRepository {
    private static final String COLUMNS = """
        id, application_id, company_id, job_id, candidate_id,
        interviewer_id, scheduled_by, round_number, schedule_revision,
        scheduled_start_at, scheduled_end_at, time_zone, duration_minutes,
        mode, location, notes, status, created_at, updated_at, version
        """;

    private final NamedParameterJdbcTemplate jdbc;

    public InterviewReadRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<InterviewReadRow> findDetail(
        UUID interviewId,
        Visibility visibility
    ) {
        StringBuilder sql = new StringBuilder(
            "SELECT " + COLUMNS + " FROM interviews WHERE id = :id"
        );
        MapSqlParameterSource parameters = new MapSqlParameterSource()
            .addValue("id", interviewId);
        addVisibility(sql, parameters, visibility);
        List<InterviewReadRow> rows = jdbc.query(
            sql.toString(),
            parameters,
            InterviewReadRepository::map
        );
        return rows.stream().findFirst();
    }

    public List<InterviewReadRow> findPage(
        Visibility visibility,
        Filters filters,
        PagePosition cursor,
        boolean ascending,
        int fetchLimit,
        Instant asOf
    ) {
        StringBuilder sql = new StringBuilder(
            "SELECT " + COLUMNS + " FROM interviews WHERE created_at <= :asOf"
        );
        MapSqlParameterSource parameters = new MapSqlParameterSource()
            .addValue("asOf", timestamp(asOf))
            .addValue("fetchLimit", fetchLimit);
        addVisibility(sql, parameters, visibility);
        addUuid(sql, parameters, "application_id", "applicationId",
            filters.applicationId());
        addUuid(sql, parameters, "job_id", "jobId", filters.jobId());
        addUuid(sql, parameters, "candidate_id", "candidateId",
            filters.candidateId());
        addUuid(sql, parameters, "interviewer_id", "filterInterviewerId",
            filters.interviewerId());
        if (!filters.statuses().isEmpty()) {
            sql.append(" AND status IN (:statuses)");
            parameters.addValue(
                "statuses",
                filters.statuses().stream().map(Enum::name).toList()
            );
        }
        if (filters.rangeStart() != null) {
            sql.append(
                " AND scheduled_start_at < :rangeEnd" +
                " AND scheduled_end_at > :rangeStart"
            );
            parameters
                .addValue("rangeStart", timestamp(filters.rangeStart()))
                .addValue("rangeEnd", timestamp(filters.rangeEnd()));
        }
        if (filters.endingAfter() != null) {
            sql.append(" AND scheduled_end_at > :endingAfter");
            parameters.addValue(
                "endingAfter",
                timestamp(filters.endingAfter())
            );
        }
        if (filters.endingAtOrBefore() != null) {
            sql.append(" AND scheduled_end_at <= :endingAtOrBefore");
            parameters.addValue(
                "endingAtOrBefore",
                timestamp(filters.endingAtOrBefore())
            );
        }
        if (cursor != null) {
            sql.append(
                ascending
                    ? " AND (scheduled_start_at, id) > " +
                        "(:cursorStart, :cursorId)"
                    : " AND (scheduled_start_at, id) < " +
                        "(:cursorStart, :cursorId)"
            );
            parameters
                .addValue("cursorStart", timestamp(cursor.scheduledStart()))
                .addValue("cursorId", cursor.id());
        }
        sql.append(
            ascending
                ? " ORDER BY scheduled_start_at ASC, id ASC"
                : " ORDER BY scheduled_start_at DESC, id DESC"
        );
        sql.append(" LIMIT :fetchLimit");
        return jdbc.query(
            sql.toString(),
            parameters,
            InterviewReadRepository::map
        );
    }

    public List<BusyInterval> findBusyIntervals(
        UUID interviewerId,
        UUID candidateId,
        Instant from,
        Instant to
    ) {
        return jdbc.query(
            """
            SELECT scheduled_start_at, scheduled_end_at
            FROM interviews
            WHERE status IN (
                'SCHEDULED', 'CONFIRMED',
                'RESCHEDULE_REQUESTED', 'IN_PROGRESS'
            )
              AND scheduled_start_at < :to
              AND scheduled_end_at > :from
              AND (
                interviewer_id = :interviewerId
                OR candidate_id = :candidateId
              )
            ORDER BY scheduled_start_at ASC, scheduled_end_at ASC
            """,
            new MapSqlParameterSource()
                .addValue("interviewerId", interviewerId)
                .addValue("candidateId", candidateId)
                .addValue("from", timestamp(from))
                .addValue("to", timestamp(to)),
            (result, row) -> new BusyInterval(
                result.getTimestamp("scheduled_start_at").toInstant(),
                result.getTimestamp("scheduled_end_at").toInstant()
            )
        );
    }

    private static void addVisibility(
        StringBuilder sql,
        MapSqlParameterSource parameters,
        Visibility visibility
    ) {
        if (visibility.candidateId() != null) {
            sql.append(" AND candidate_id = :visibleCandidateId");
            parameters.addValue(
                "visibleCandidateId",
                visibility.candidateId()
            );
        } else {
            sql.append(" AND company_id = :visibleCompanyId");
            parameters.addValue("visibleCompanyId", visibility.companyId());
            if (visibility.interviewerId() != null) {
                sql.append(" AND interviewer_id = :visibleInterviewerId");
                parameters.addValue(
                    "visibleInterviewerId",
                    visibility.interviewerId()
                );
            }
        }
    }

    private static void addUuid(
        StringBuilder sql,
        MapSqlParameterSource parameters,
        String column,
        String parameter,
        UUID value
    ) {
        if (value != null) {
            sql.append(" AND ").append(column).append(" = :")
                .append(parameter);
            parameters.addValue(parameter, value);
        }
    }

    private static Timestamp timestamp(Instant value) {
        return Timestamp.from(value);
    }

    private static InterviewReadRow map(
        ResultSet result,
        int row
    ) throws SQLException {
        return new InterviewReadRow(
            result.getObject("id", UUID.class),
            result.getObject("application_id", UUID.class),
            result.getObject("company_id", UUID.class),
            result.getObject("job_id", UUID.class),
            result.getObject("candidate_id", UUID.class),
            result.getObject("interviewer_id", UUID.class),
            result.getObject("scheduled_by", UUID.class),
            result.getInt("round_number"),
            result.getInt("schedule_revision"),
            result.getTimestamp("scheduled_start_at").toInstant(),
            result.getTimestamp("scheduled_end_at").toInstant(),
            result.getString("time_zone"),
            result.getInt("duration_minutes"),
            InterviewMode.valueOf(result.getString("mode")),
            result.getString("location"),
            result.getString("notes"),
            InterviewStatus.valueOf(result.getString("status")),
            result.getTimestamp("created_at").toInstant(),
            result.getTimestamp("updated_at").toInstant(),
            result.getLong("version")
        );
    }

    public record Visibility(
        UUID candidateId,
        UUID companyId,
        UUID interviewerId
    ) {
        public static Visibility candidate(UUID candidateId) {
            return new Visibility(candidateId, null, null);
        }

        public static Visibility company(UUID companyId) {
            return new Visibility(null, companyId, null);
        }

        public static Visibility interviewer(
            UUID companyId,
            UUID interviewerId
        ) {
            return new Visibility(null, companyId, interviewerId);
        }
    }

    public record Filters(
        UUID applicationId,
        UUID jobId,
        UUID candidateId,
        UUID interviewerId,
        List<InterviewStatus> statuses,
        Instant rangeStart,
        Instant rangeEnd,
        Instant endingAfter,
        Instant endingAtOrBefore
    ) {
        public Filters {
            statuses = List.copyOf(statuses);
        }
    }

    public record PagePosition(Instant scheduledStart, UUID id) {}

    public record BusyInterval(Instant start, Instant end) {}

    public record InterviewReadRow(
        UUID id,
        UUID applicationId,
        UUID companyId,
        UUID jobId,
        UUID candidateId,
        UUID interviewerId,
        UUID scheduledBy,
        int roundNumber,
        int scheduleRevision,
        Instant scheduledStart,
        Instant scheduledEnd,
        String timeZone,
        int durationMinutes,
        InterviewMode mode,
        String location,
        String notes,
        InterviewStatus status,
        Instant createdAt,
        Instant updatedAt,
        long version
    ) {}
}
