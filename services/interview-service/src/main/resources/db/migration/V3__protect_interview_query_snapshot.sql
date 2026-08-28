CREATE INDEX interviews_company_job_calendar_v3_idx
    ON interviews(company_id, job_id, scheduled_start_at, id);

CREATE FUNCTION enforce_interview_snapshot_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, interview
AS $$
BEGIN
    IF ROW(
        NEW.id,
        NEW.application_id,
        NEW.application_version,
        NEW.application_status_at_schedule,
        NEW.company_id,
        NEW.job_id,
        NEW.candidate_id,
        NEW.interviewer_id,
        NEW.scheduled_by,
        NEW.request_id,
        NEW.request_hash,
        NEW.round_number,
        NEW.schedule_revision,
        NEW.supersedes_interview_id,
        NEW.scheduled_start_at,
        NEW.scheduled_end_at,
        NEW.time_zone,
        NEW.duration_minutes,
        NEW.mode,
        NEW.location,
        NEW.notes,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.id,
        OLD.application_id,
        OLD.application_version,
        OLD.application_status_at_schedule,
        OLD.company_id,
        OLD.job_id,
        OLD.candidate_id,
        OLD.interviewer_id,
        OLD.scheduled_by,
        OLD.request_id,
        OLD.request_hash,
        OLD.round_number,
        OLD.schedule_revision,
        OLD.supersedes_interview_id,
        OLD.scheduled_start_at,
        OLD.scheduled_end_at,
        OLD.time_zone,
        OLD.duration_minutes,
        OLD.mode,
        OLD.location,
        OLD.notes,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'interviews_snapshot_immutable',
            MESSAGE = 'Interview identity and schedule snapshot are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER interviews_snapshot_immutable_trigger
BEFORE UPDATE ON interviews
FOR EACH ROW
EXECUTE FUNCTION enforce_interview_snapshot_immutable();
