CREATE TABLE applications (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    company_id UUID NOT NULL,
    candidate_id UUID NOT NULL,
    recruiter_id UUID NOT NULL,
    cv_id UUID NOT NULL,
    job_title VARCHAR(200) NOT NULL,
    cover_letter VARCHAR(2000),
    status VARCHAR(30) NOT NULL,
    source VARCHAR(30) NOT NULL,
    match_score NUMERIC(5,2),
    applied_at TIMESTAMPTZ(3) NOT NULL,
    updated_at TIMESTAMPTZ(3) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT applications_status_check CHECK (
        status IN (
            'APPLIED', 'REVIEWING', 'INTERVIEW', 'OFFER',
            'HIRED', 'REJECTED', 'WITHDRAWN'
        )
    ),
    CONSTRAINT applications_source_check CHECK (
        source IN (
            'SEARCH', 'AI_RECOMMENDATION', 'COMPANY_PAGE',
            'SHARED_LINK', 'OTHER'
        )
    ),
    CONSTRAINT applications_match_score_check CHECK (
        match_score IS NULL OR (match_score >= 0 AND match_score <= 100)
    )
);

CREATE UNIQUE INDEX applications_one_active_candidate_job_idx
    ON applications(candidate_id, job_id)
    WHERE status IN (
        'APPLIED', 'REVIEWING', 'INTERVIEW', 'OFFER', 'HIRED'
    );
CREATE INDEX applications_candidate_applied_idx
    ON applications(candidate_id, applied_at DESC);
CREATE INDEX applications_job_status_idx
    ON applications(job_id, status, applied_at DESC);
CREATE INDEX applications_company_status_idx
    ON applications(company_id, status, applied_at DESC);

CREATE TABLE application_history (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    from_status VARCHAR(30),
    to_status VARCHAR(30) NOT NULL,
    changed_by UUID NOT NULL,
    note VARCHAR(2000),
    changed_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX application_history_timeline_idx
    ON application_history(application_id, changed_at ASC);

CREATE TABLE application_event_outbox (
    id UUID PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    event_key UUID NOT NULL,
    topic VARCHAR(200) NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ(3) NOT NULL,
    published_at TIMESTAMPTZ(3),
    last_error VARCHAR(2000),
    created_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX application_event_outbox_pending_idx
    ON application_event_outbox(next_attempt_at, created_at)
    WHERE published_at IS NULL;
