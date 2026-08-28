CREATE TABLE interview_event_outbox (
    event_id UUID PRIMARY KEY,
    stream_position BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    interview_id UUID NOT NULL
        REFERENCES interviews(id) ON DELETE RESTRICT,
    aggregate_version BIGINT NOT NULL,
    action VARCHAR(30) NOT NULL,
    topic VARCHAR(100) NOT NULL,
    event_key UUID NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ(3) NOT NULL,
    lease_owner VARCHAR(64),
    lease_fence BIGINT NOT NULL DEFAULT 0,
    lease_expires_at TIMESTAMPTZ(3),
    published_at TIMESTAMPTZ(3),
    last_error_code VARCHAR(96),
    created_at TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT interview_event_outbox_interview_version_unique
        UNIQUE (interview_id, aggregate_version),
    CONSTRAINT interview_event_outbox_aggregate_version_check CHECK (
        aggregate_version BETWEEN 0 AND 9007199254740991
    ),
    CONSTRAINT interview_event_outbox_action_check CHECK (
        action = 'SCHEDULED'
    ),
    CONSTRAINT interview_event_outbox_topic_check CHECK (
        topic ~ '^[a-z0-9._-]{1,100}$'
        AND topic NOT IN ('.', '..')
    ),
    CONSTRAINT interview_event_outbox_key_check CHECK (
        event_key = interview_id
    ),
    CONSTRAINT interview_event_outbox_attempts_check CHECK (
        attempts >= 0 AND lease_fence >= 0
    ),
    CONSTRAINT interview_event_outbox_lease_check CHECK (
        (lease_owner IS NULL) = (lease_expires_at IS NULL)
    ),
    CONSTRAINT interview_event_outbox_published_lease_check CHECK (
        published_at IS NULL
        OR (lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT interview_event_outbox_error_code_check CHECK (
        last_error_code IS NULL
        OR last_error_code ~ '^[A-Za-z][A-Za-z0-9_.-]{0,95}$'
    ),
    CONSTRAINT interview_event_outbox_payload_check CHECK (
        jsonb_typeof(payload) = 'object'
        AND payload ?& ARRAY[
            'schema_version',
            'event_id',
            'action',
            'interview_id',
            'application_id',
            'candidate_id',
            'interviewer_id',
            'actor_id',
            'round_number',
            'schedule_revision',
            'scheduled_start_at',
            'scheduled_end_at',
            'status',
            'aggregate_version',
            'occurred_at'
        ]
        AND (
            payload - ARRAY[
                'schema_version',
                'event_id',
                'action',
                'interview_id',
                'application_id',
                'candidate_id',
                'interviewer_id',
                'actor_id',
                'round_number',
                'schedule_revision',
                'scheduled_start_at',
                'scheduled_end_at',
                'status',
                'aggregate_version',
                'occurred_at'
            ]
        ) = '{}'::jsonb
        AND payload->'schema_version' = '1'::jsonb
        AND jsonb_typeof(payload->'event_id') = 'string'
        AND payload->>'event_id'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND payload->>'event_id' = event_id::text
        AND jsonb_typeof(payload->'action') = 'string'
        AND payload->>'action' = action
        AND jsonb_typeof(payload->'interview_id') = 'string'
        AND payload->>'interview_id' = interview_id::text
        AND payload->>'interviewer_id' = payload->>'actor_id'
        AND payload->>'candidate_id' <> payload->>'interviewer_id'
        AND payload->>'application_id'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND payload->>'candidate_id'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND payload->>'interviewer_id'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND payload->>'actor_id'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND jsonb_typeof(payload->'application_id') = 'string'
        AND jsonb_typeof(payload->'candidate_id') = 'string'
        AND jsonb_typeof(payload->'interviewer_id') = 'string'
        AND jsonb_typeof(payload->'actor_id') = 'string'
        AND jsonb_typeof(payload->'round_number') = 'number'
        AND (payload->>'round_number') ~ '^[0-9]+$'
        AND (payload->>'round_number')::INTEGER BETWEEN 1 AND 20
        AND jsonb_typeof(payload->'schedule_revision') = 'number'
        AND (payload->>'schedule_revision') ~ '^[0-9]+$'
        AND (payload->>'schedule_revision')::NUMERIC
            BETWEEN 1 AND 9007199254740991
        AND jsonb_typeof(payload->'aggregate_version') = 'number'
        AND payload->>'aggregate_version' = aggregate_version::text
        AND jsonb_typeof(payload->'status') = 'string'
        AND payload->>'status' = 'SCHEDULED'
        AND jsonb_typeof(payload->'scheduled_start_at') = 'string'
        AND jsonb_typeof(payload->'scheduled_end_at') = 'string'
        AND jsonb_typeof(payload->'occurred_at') = 'string'
        AND payload->>'scheduled_start_at'
            ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        AND payload->>'scheduled_end_at'
            ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        AND payload->>'occurred_at'
            ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        AND (payload->>'scheduled_end_at')::TIMESTAMPTZ
            > (payload->>'scheduled_start_at')::TIMESTAMPTZ
        AND (payload->>'occurred_at')::TIMESTAMPTZ = created_at
    )
);

CREATE INDEX interview_event_outbox_pending_idx
    ON interview_event_outbox(next_attempt_at, stream_position)
    WHERE published_at IS NULL;

CREATE INDEX interview_event_outbox_lease_idx
    ON interview_event_outbox(lease_expires_at)
    WHERE published_at IS NULL;

CREATE INDEX interview_event_outbox_published_idx
    ON interview_event_outbox(published_at)
    WHERE published_at IS NOT NULL;

CREATE FUNCTION protect_interview_event_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW.event_id,
        NEW.stream_position,
        NEW.interview_id,
        NEW.aggregate_version,
        NEW.action,
        NEW.topic,
        NEW.event_key,
        NEW.payload,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.event_id,
        OLD.stream_position,
        OLD.interview_id,
        OLD.aggregate_version,
        OLD.action,
        OLD.topic,
        OLD.event_key,
        OLD.payload,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = 'Interview event identity and payload are immutable';
    END IF;
    IF OLD.published_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING
            ERRCODE = 'check_violation',
            MESSAGE = 'Published Interview event rows are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER interview_event_outbox_immutable
BEFORE UPDATE ON interview_event_outbox
FOR EACH ROW
EXECUTE FUNCTION protect_interview_event_outbox();
