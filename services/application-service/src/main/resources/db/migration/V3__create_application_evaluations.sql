CREATE TABLE evaluations (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL
        REFERENCES applications(id) ON DELETE CASCADE,
    evaluator_id UUID NOT NULL,
    score NUMERIC(5,2) NOT NULL,
    criteria_json JSONB NOT NULL,
    note VARCHAR(2000),
    created_at TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT evaluations_score_check CHECK (
        score >= 0 AND score <= 100
    ),
    CONSTRAINT evaluations_criteria_object_check CHECK (
        jsonb_typeof(criteria_json) = 'object'
    ),
    CONSTRAINT evaluations_criteria_non_empty_check CHECK (
        criteria_json <> '{}'::jsonb
    ),
    CONSTRAINT evaluations_application_evaluator_unique UNIQUE (
        application_id,
        evaluator_id
    )
);

CREATE INDEX evaluations_application_created_idx
    ON evaluations(application_id, created_at DESC);
