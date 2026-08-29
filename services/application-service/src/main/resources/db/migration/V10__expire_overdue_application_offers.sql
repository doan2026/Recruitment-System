-- A SENT Offer past expires_at can never be responded to: the runtime already
-- rejects late responses. Give that lapse a durable terminal row instead of
-- leaving a SENT row that only looks respondable.
ALTER TABLE offers
    DROP CONSTRAINT offers_status_check,
    DROP CONSTRAINT offers_response_coherence_check;

-- Backfill uses expires_at, not the migration clock, so the repaired row
-- carries the moment the Offer actually lapsed. The runtime expiry worker
-- writes the same value, so a row repaired here and a row expired later are
-- indistinguishable. offers_expiry_after_sent_check already guarantees
-- expires_at > sent_at, so responded_at stays after sent_at.
UPDATE offers
SET status = 'EXPIRED',
    responded_at = expires_at,
    response_note = NULL,
    version = version + 1
WHERE status = 'SENT'
  AND expires_at <= now();

ALTER TABLE offers
    ADD CONSTRAINT offers_status_check CHECK (
        status IN (
            'SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'
        )
    ),
    ADD CONSTRAINT offers_response_coherence_check CHECK (
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
        ) OR (
            status = 'CANCELLED' AND
            responded_at IS NOT NULL AND
            response_note IS NULL
        ) OR (
            status = 'EXPIRED' AND
            responded_at IS NOT NULL AND
            response_note IS NULL
        )
    );
