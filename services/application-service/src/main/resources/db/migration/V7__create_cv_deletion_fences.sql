-- Serialize the first committed Application for a CV with the irreversible
-- decision to delete that CV in Profile Service. The applications lock makes
-- this migration safe during a rolling deployment: every old writer finishes
-- before gates are backfilled and the database trigger is installed.
LOCK TABLE applications IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE application_cv_usage IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE cv_submission_gates (
    cv_id UUID PRIMARY KEY,
    candidate_id UUID NOT NULL,
    state VARCHAR(30) NOT NULL,
    deletion_request_id UUID,
    fenced_at TIMESTAMPTZ(3),
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT cv_submission_gates_state_check CHECK (
        state IN ('OPEN', 'DELETE_FENCED')
    ),
    CONSTRAINT cv_submission_gates_fence_shape_check CHECK (
        (
            state = 'OPEN'
            AND deletion_request_id IS NULL
            AND fenced_at IS NULL
        ) OR (
            state = 'DELETE_FENCED'
            AND deletion_request_id IS NOT NULL
            AND fenced_at IS NOT NULL
        )
    ),
    CONSTRAINT cv_submission_gates_cv_candidate_unique
        UNIQUE (cv_id, candidate_id),
    CONSTRAINT cv_submission_gates_deletion_request_unique
        UNIQUE (deletion_request_id)
);

INSERT INTO cv_submission_gates (
    cv_id,
    candidate_id,
    state,
    created_at
)
SELECT
    cv_id,
    candidate_id,
    'OPEN',
    first_used_at
FROM application_cv_usage;

ALTER TABLE application_cv_usage
    ADD CONSTRAINT application_cv_usage_gate_owner_fk
    FOREIGN KEY (cv_id, candidate_id)
    REFERENCES cv_submission_gates (cv_id, candidate_id)
    ON DELETE RESTRICT;

-- Gate rows are durable tombstones. They can only move once from OPEN to
-- DELETE_FENCED, and the transition is rejected when authoritative usage
-- already exists. There is intentionally no expiry or reopen transition.
CREATE FUNCTION protect_cv_submission_gate() RETURNS TRIGGER AS $$
DECLARE
    cv_used BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CV submission gates cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.state <> 'OPEN'
           OR NEW.deletion_request_id IS NOT NULL
           OR NEW.fenced_at IS NOT NULL THEN
            RAISE EXCEPTION 'CV submission gates must be created open'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.cv_id IS DISTINCT FROM OLD.cv_id
       OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR OLD.state <> 'OPEN'
       OR OLD.deletion_request_id IS NOT NULL
       OR OLD.fenced_at IS NOT NULL
       OR NEW.state <> 'DELETE_FENCED'
       OR NEW.deletion_request_id IS NULL
       OR NEW.fenced_at IS NULL THEN
        RAISE EXCEPTION 'CV deletion fences are immutable'
            USING ERRCODE = '23514';
    END IF;

    EXECUTE format(
        'SELECT EXISTS (' ||
        'SELECT 1 FROM %I.application_cv_usage WHERE cv_id = $1' ||
        ')',
        TG_TABLE_SCHEMA
    )
    INTO cv_used
    USING OLD.cv_id;

    IF cv_used THEN
        RAISE EXCEPTION 'a used CV cannot be fenced for deletion'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cv_submission_gates_protect
BEFORE INSERT OR UPDATE OR DELETE ON cv_submission_gates
FOR EACH ROW EXECUTE FUNCTION protect_cv_submission_gate();

-- This trigger is the rolling-deploy/direct-SQL safety net. The Java
-- submission path takes the same row lock so it can return the stable public
-- CV_NOT_AVAILABLE error instead of exposing a database constraint failure.
CREATE FUNCTION enforce_cv_submission_gate() RETURNS TRIGGER AS $$
DECLARE
    gate_candidate_id UUID;
    gate_state VARCHAR(30);
BEGIN
    EXECUTE format(
        'INSERT INTO %I.cv_submission_gates (' ||
        'cv_id, candidate_id, state' ||
        ') VALUES ($1, $2, ''OPEN'') ' ||
        'ON CONFLICT (cv_id) DO NOTHING',
        TG_TABLE_SCHEMA
    )
    USING NEW.cv_id, NEW.candidate_id;

    EXECUTE format(
        'SELECT candidate_id, state ' ||
        'FROM %I.cv_submission_gates ' ||
        'WHERE cv_id = $1 FOR UPDATE',
        TG_TABLE_SCHEMA
    )
    INTO STRICT gate_candidate_id, gate_state
    USING NEW.cv_id;

    IF gate_candidate_id IS DISTINCT FROM NEW.candidate_id THEN
        RAISE EXCEPTION 'one CV cannot belong to multiple candidates'
            USING ERRCODE = '23514';
    END IF;

    IF gate_state <> 'OPEN' THEN
        RAISE EXCEPTION 'CV is fenced for deletion'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_enforce_cv_submission_gate
BEFORE INSERT ON applications
FOR EACH ROW EXECUTE FUNCTION enforce_cv_submission_gate();

-- V6 predated isolated-schema migration tests and wrote to the deployed
-- `application` schema explicitly. Replace it so every trigger invocation
-- records usage beside its own applications table, including tenant/test
-- schemas. `%I` safely quotes the server-provided schema identifier.
CREATE OR REPLACE FUNCTION record_application_cv_usage() RETURNS TRIGGER AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    EXECUTE format(
        'INSERT INTO %I.application_cv_usage AS usage (' ||
        'cv_id, candidate_id, first_used_at, application_count' ||
        ') VALUES ($1, $2, $3, 1) ' ||
        'ON CONFLICT (cv_id) DO UPDATE ' ||
        'SET first_used_at = LEAST(' ||
        'usage.first_used_at, EXCLUDED.first_used_at' ||
        '), application_count = usage.application_count + 1 ' ||
        'WHERE usage.candidate_id = EXCLUDED.candidate_id',
        TG_TABLE_SCHEMA
    )
    USING NEW.cv_id, NEW.candidate_id, NEW.applied_at;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows = 0 THEN
        RAISE EXCEPTION 'one CV cannot belong to multiple candidates'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
