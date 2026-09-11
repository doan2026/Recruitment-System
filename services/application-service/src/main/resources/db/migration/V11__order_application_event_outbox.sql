-- Derive the authoritative order from the immutable event payload. Legacy
-- pre-v1 events have NULL and drain first, ordered by their creation timestamp.
-- The generated value also covers rolling writers without requiring a new DTO.
ALTER TABLE application_event_outbox
    ADD COLUMN aggregate_version BIGINT
    GENERATED ALWAYS AS ((payload::jsonb ->> 'aggregate_version')::BIGINT) STORED;

CREATE INDEX application_event_outbox_aggregate_pending_idx
    ON application_event_outbox (
        aggregate_id,
        (COALESCE(aggregate_version, -1)),
        created_at,
        id
    )
    WHERE published_at IS NULL;
