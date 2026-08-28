ALTER TABLE applications
    ADD COLUMN profile_skill_snapshot_schema_version INTEGER,
    ADD COLUMN profile_aggregate_version BIGINT,
    ADD COLUMN profile_skill_snapshot_expected_count INTEGER,
    ADD CONSTRAINT applications_profile_skill_snapshot_shape_check CHECK (
        (
            profile_skill_snapshot_schema_version IS NULL
            AND profile_aggregate_version IS NULL
            AND profile_skill_snapshot_expected_count IS NULL
        ) OR (
            profile_skill_snapshot_schema_version IS NOT NULL
            AND profile_aggregate_version IS NOT NULL
            AND profile_skill_snapshot_expected_count IS NOT NULL
            AND profile_skill_snapshot_schema_version = 1
            AND profile_aggregate_version > 0
            AND profile_skill_snapshot_expected_count BETWEEN 0 AND 100
        )
    );

CREATE TABLE application_profile_skill_snapshots (
    application_id UUID NOT NULL
        REFERENCES applications(id) ON DELETE CASCADE,
    skill_name VARCHAR(120) NOT NULL,
    normalized_name VARCHAR(120)
        GENERATED ALWAYS AS (LOWER(BTRIM(skill_name))) STORED,
    CONSTRAINT application_profile_skill_snapshots_name_check CHECK (
        skill_name = BTRIM(skill_name)
        AND skill_name <> ''
        AND skill_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT application_profile_skill_snapshots_pk PRIMARY KEY (
        application_id,
        normalized_name
    )
);

CREATE INDEX application_profile_skill_snapshots_filter_idx
    ON application_profile_skill_snapshots (
        normalized_name,
        application_id
    );

-- Preserve the exact Profile aggregate that produced a submission. Nullable
-- metadata remains valid for applications committed by older service versions.
CREATE OR REPLACE FUNCTION protect_application_identity() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
       OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
       OR NEW.cv_id IS DISTINCT FROM OLD.cv_id
       OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
       OR NEW.profile_skill_snapshot_schema_version IS DISTINCT FROM
            OLD.profile_skill_snapshot_schema_version
       OR NEW.profile_aggregate_version IS DISTINCT FROM
            OLD.profile_aggregate_version
       OR NEW.profile_skill_snapshot_expected_count IS DISTINCT FROM
            OLD.profile_skill_snapshot_expected_count THEN
        RAISE EXCEPTION
            'application identity and Profile skill snapshot are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION enforce_application_profile_skill_snapshot()
RETURNS TRIGGER AS $$
DECLARE
    snapshot_schema_version INTEGER;
    expected_count INTEGER;
    existing_count BIGINT;
BEGIN
    -- Serialize every child insert for one application before counting. This
    -- prevents concurrent statements from both observing spare capacity.
    EXECUTE format(
        'SELECT profile_skill_snapshot_schema_version, ' ||
        'profile_skill_snapshot_expected_count ' ||
        'FROM %I.applications WHERE id = $1 FOR UPDATE',
        TG_TABLE_SCHEMA
    )
    INTO snapshot_schema_version, expected_count
    USING NEW.application_id;

    IF snapshot_schema_version IS DISTINCT FROM 1
       OR expected_count IS NULL THEN
        RAISE EXCEPTION
            'skill rows require an application Profile snapshot'
            USING ERRCODE = '23514';
    END IF;

    EXECUTE format(
        'SELECT COUNT(*) FROM ' ||
        '%I.application_profile_skill_snapshots ' ||
        'WHERE application_id = $1',
        TG_TABLE_SCHEMA
    )
    INTO existing_count
    USING NEW.application_id;

    IF existing_count >= expected_count THEN
        RAISE EXCEPTION
            'application Profile skill snapshot exceeds expected count'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER application_profile_skill_snapshots_validate
BEFORE INSERT ON application_profile_skill_snapshots
FOR EACH ROW EXECUTE FUNCTION enforce_application_profile_skill_snapshot();

CREATE FUNCTION protect_application_profile_skill_snapshot()
RETURNS TRIGGER AS $$
DECLARE
    application_exists BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'application Profile skill snapshots are immutable'
            USING ERRCODE = '23514';
    END IF;

    -- A direct child delete would silently change recruiter filtering. Permit
    -- only the foreign-key cascade after its parent application is deleted.
    EXECUTE format(
        'SELECT EXISTS (' ||
        'SELECT 1 FROM %I.applications WHERE id = $1' ||
        ')',
        TG_TABLE_SCHEMA
    )
    INTO application_exists
    USING OLD.application_id;

    IF application_exists AND pg_trigger_depth() = 1 THEN
        RAISE EXCEPTION
            'application Profile skill snapshots cannot be deleted independently'
            USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER application_profile_skill_snapshots_protect
BEFORE UPDATE OR DELETE ON application_profile_skill_snapshots
FOR EACH ROW EXECUTE FUNCTION protect_application_profile_skill_snapshot();

-- A parent INSERT always queues this commit-time check, including snapshots
-- with zero children. Child events queue it again as defense in depth.
CREATE FUNCTION validate_application_profile_skill_snapshot_count()
RETURNS TRIGGER AS $$
DECLARE
    target_application_id UUID;
    expected_count INTEGER;
    actual_count BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'applications' THEN
        target_application_id := NEW.id;
    ELSE
        target_application_id := CASE
            WHEN TG_OP = 'DELETE' THEN OLD.application_id
            ELSE NEW.application_id
        END;
    END IF;

    EXECUTE format(
        'SELECT profile_skill_snapshot_expected_count ' ||
        'FROM %I.applications WHERE id = $1',
        TG_TABLE_SCHEMA
    )
    INTO expected_count
    USING target_application_id;

    -- Legacy rows and a child cascade after parent deletion have no expected
    -- count. They remain compatible and intentionally receive no backfill.
    IF expected_count IS NULL THEN
        RETURN NULL;
    END IF;

    EXECUTE format(
        'SELECT COUNT(*) FROM ' ||
        '%I.application_profile_skill_snapshots ' ||
        'WHERE application_id = $1',
        TG_TABLE_SCHEMA
    )
    INTO actual_count
    USING target_application_id;

    IF actual_count <> expected_count THEN
        RAISE EXCEPTION
            'application Profile skill snapshot count mismatch'
            USING ERRCODE = '23514',
                  DETAIL = format(
                      'application_id=%s expected=%s actual=%s',
                      target_application_id,
                      expected_count,
                      actual_count
                  );
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER applications_profile_skill_snapshot_count_check
AFTER INSERT OR UPDATE ON applications
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_application_profile_skill_snapshot_count();

CREATE CONSTRAINT TRIGGER application_profile_skill_snapshots_count_check
AFTER INSERT OR UPDATE OR DELETE ON application_profile_skill_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_application_profile_skill_snapshot_count();
