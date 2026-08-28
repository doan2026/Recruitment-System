CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE interviews (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL,
    application_version BIGINT NOT NULL,
    application_status_at_schedule VARCHAR(30) NOT NULL,
    company_id UUID NOT NULL,
    job_id UUID NOT NULL,
    candidate_id UUID NOT NULL,
    interviewer_id UUID NOT NULL,
    scheduled_by UUID NOT NULL,
    request_id UUID NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    round_number SMALLINT NOT NULL,
    schedule_revision INTEGER NOT NULL DEFAULT 1,
    supersedes_interview_id UUID
        REFERENCES interviews(id) ON DELETE RESTRICT,
    scheduled_start_at TIMESTAMPTZ(3) NOT NULL,
    scheduled_end_at TIMESTAMPTZ(3) NOT NULL,
    time_zone VARCHAR(100) NOT NULL,
    duration_minutes SMALLINT NOT NULL,
    mode VARCHAR(20) NOT NULL,
    location VARCHAR(500),
    notes VARCHAR(2000),
    status VARCHAR(30) NOT NULL,
    confirmed_at TIMESTAMPTZ(3),
    cancelled_at TIMESTAMPTZ(3),
    cancelled_by UUID,
    cancel_reason VARCHAR(500),
    started_at TIMESTAMPTZ(3),
    ended_at TIMESTAMPTZ(3),
    created_at TIMESTAMPTZ(3) NOT NULL,
    updated_at TIMESTAMPTZ(3) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT interviews_application_version_check CHECK (
        application_version >= 0
    ),
    CONSTRAINT interviews_application_status_check CHECK (
        application_status_at_schedule IN ('REVIEWING', 'INTERVIEW')
    ),
    CONSTRAINT interviews_request_unique UNIQUE (scheduled_by, request_id),
    CONSTRAINT interviews_request_hash_check CHECK (
        request_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT interviews_round_check CHECK (
        round_number BETWEEN 1 AND 20
    ),
    CONSTRAINT interviews_revision_check CHECK (schedule_revision > 0),
    CONSTRAINT interviews_not_self_superseding_check CHECK (
        supersedes_interview_id IS NULL OR supersedes_interview_id <> id
    ),
    CONSTRAINT interviews_duration_check CHECK (
        duration_minutes IN (30, 45, 60)
    ),
    CONSTRAINT interviews_time_order_check CHECK (
        scheduled_end_at > scheduled_start_at
        AND scheduled_end_at = scheduled_start_at
            + make_interval(mins => duration_minutes)
    ),
    CONSTRAINT interviews_time_zone_check CHECK (
        time_zone = btrim(time_zone)
        AND time_zone <> ''
        AND time_zone !~ '[[:cntrl:]]'
    ),
    CONSTRAINT interviews_mode_check CHECK (mode IN ('ONLINE', 'OFFLINE')),
    CONSTRAINT interviews_location_shape_check CHECK (
        (
            mode = 'OFFLINE'
            AND location IS NOT NULL
            AND location = btrim(location)
            AND location <> ''
            AND location !~ '[[:cntrl:]]'
        ) OR (
            mode = 'ONLINE'
            AND location IS NULL
        )
    ),
    CONSTRAINT interviews_notes_shape_check CHECK (
        notes IS NULL OR (
            notes = btrim(notes)
            AND notes <> ''
            AND notes !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT interviews_status_check CHECK (
        status IN (
            'SCHEDULED', 'CONFIRMED', 'RESCHEDULE_REQUESTED',
            'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
        )
    ),
    CONSTRAINT interviews_audit_time_check CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX interviews_active_application_round_idx
    ON interviews(application_id, round_number)
    WHERE status IN (
        'SCHEDULED', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'IN_PROGRESS'
    );

ALTER TABLE interviews ADD CONSTRAINT interviews_candidate_schedule_excl
    EXCLUDE USING gist (
        candidate_id WITH =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
    )
    WHERE (status IN (
        'SCHEDULED', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'IN_PROGRESS'
    ));

ALTER TABLE interviews ADD CONSTRAINT interviews_interviewer_schedule_excl
    EXCLUDE USING gist (
        interviewer_id WITH =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
    )
    WHERE (status IN (
        'SCHEDULED', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'IN_PROGRESS'
    ));

CREATE INDEX interviews_company_calendar_idx
    ON interviews(company_id, scheduled_start_at, id);
CREATE INDEX interviews_candidate_calendar_idx
    ON interviews(candidate_id, scheduled_start_at, id);
CREATE INDEX interviews_interviewer_calendar_idx
    ON interviews(interviewer_id, scheduled_start_at, id);
CREATE INDEX interviews_application_history_idx
    ON interviews(application_id, round_number, schedule_revision DESC);
