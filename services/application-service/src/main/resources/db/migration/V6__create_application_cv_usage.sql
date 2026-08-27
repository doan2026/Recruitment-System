LOCK TABLE applications IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT cv_id
        FROM applications
        GROUP BY cv_id
        HAVING COUNT(DISTINCT candidate_id) > 1
    ) THEN
        RAISE EXCEPTION 'one CV cannot belong to multiple candidates'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE TABLE application_cv_usage (
    cv_id UUID PRIMARY KEY,
    candidate_id UUID NOT NULL,
    first_used_at TIMESTAMPTZ(3) NOT NULL,
    application_count BIGINT NOT NULL,
    CONSTRAINT application_cv_usage_count_positive_check CHECK (
        application_count > 0
    )
);

INSERT INTO application_cv_usage (
    cv_id,
    candidate_id,
    first_used_at,
    application_count
)
SELECT
    cv_id,
    (ARRAY_AGG(candidate_id ORDER BY applied_at, id))[1],
    MIN(applied_at),
    COUNT(*)
FROM applications
GROUP BY cv_id;

CREATE INDEX applications_cv_candidate_applied_idx
    ON applications(cv_id, candidate_id, applied_at);

CREATE FUNCTION protect_application_identity() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
       OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
       OR NEW.cv_id IS DISTINCT FROM OLD.cv_id
       OR NEW.applied_at IS DISTINCT FROM OLD.applied_at THEN
        RAISE EXCEPTION 'application identity and CV reference are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_identity_immutable
BEFORE UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION protect_application_identity();

CREATE FUNCTION record_application_cv_usage() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO application.application_cv_usage AS usage (
        cv_id,
        candidate_id,
        first_used_at,
        application_count
    ) VALUES (
        NEW.cv_id,
        NEW.candidate_id,
        NEW.applied_at,
        1
    )
    ON CONFLICT (cv_id) DO UPDATE
    SET first_used_at = LEAST(usage.first_used_at, EXCLUDED.first_used_at),
        application_count = usage.application_count + 1
    WHERE usage.candidate_id = EXCLUDED.candidate_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'one CV cannot belong to multiple candidates'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_record_cv_usage
AFTER INSERT ON applications
FOR EACH ROW EXECUTE FUNCTION record_application_cv_usage();
