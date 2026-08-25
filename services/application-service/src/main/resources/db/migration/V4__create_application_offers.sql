CREATE TABLE offers (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL
        REFERENCES applications(id) ON DELETE CASCADE,
    sent_by UUID NOT NULL,
    salary NUMERIC(19,2) NOT NULL,
    start_date DATE NOT NULL,
    position VARCHAR(200) NOT NULL,
    note VARCHAR(2000),
    file_id UUID,
    file_url VARCHAR(2048),
    status VARCHAR(30) NOT NULL,
    sent_at TIMESTAMPTZ(3) NOT NULL,
    expires_at TIMESTAMPTZ(3) NOT NULL,
    responded_at TIMESTAMPTZ(3),
    response_note VARCHAR(2000),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT offers_application_unique UNIQUE (application_id),
    CONSTRAINT offers_salary_positive_check CHECK (salary > 0),
    CONSTRAINT offers_position_non_blank_check CHECK (
        btrim(position) <> ''
    ),
    CONSTRAINT offers_expiry_after_sent_check CHECK (
        expires_at > sent_at
    ),
    CONSTRAINT offers_file_pair_check CHECK (
        (file_id IS NULL AND file_url IS NULL) OR
        (file_id IS NOT NULL AND file_url IS NOT NULL)
    ),
    CONSTRAINT offers_status_check CHECK (
        status IN ('SENT', 'ACCEPTED', 'DECLINED')
    ),
    CONSTRAINT offers_response_coherence_check CHECK (
        (
            status = 'SENT' AND
            responded_at IS NULL AND
            response_note IS NULL
        ) OR (
            status = 'ACCEPTED' AND
            responded_at IS NOT NULL
        ) OR (
            status = 'DECLINED' AND
            responded_at IS NOT NULL AND
            response_note IS NOT NULL AND
            btrim(response_note) <> ''
        )
    )
);

CREATE INDEX offers_pending_expiry_idx
    ON offers(expires_at)
    WHERE status = 'SENT';
