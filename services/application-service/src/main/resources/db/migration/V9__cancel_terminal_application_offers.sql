-- An Application may leave OFFER through Recruiter rejection or Candidate
-- withdrawal. Resolve the linked Offer in the same terminal transition instead
-- of leaving a permanently respondable SENT row behind.
ALTER TABLE offers
    DROP CONSTRAINT offers_status_check,
    DROP CONSTRAINT offers_response_coherence_check;

-- Repair rows produced by older Application replicas before the stronger
-- runtime invariant was introduced. Application.updated_at is the durable
-- transition timestamp; GREATEST protects legacy rows with coarse timestamps.
UPDATE offers AS offer
SET status = 'CANCELLED',
    responded_at = GREATEST(application.updated_at, offer.sent_at),
    response_note = NULL,
    version = offer.version + 1
FROM applications AS application
WHERE application.id = offer.application_id
  AND application.status IN ('REJECTED', 'WITHDRAWN')
  AND offer.status = 'SENT';

ALTER TABLE offers
    ADD CONSTRAINT offers_status_check CHECK (
        status IN ('SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED')
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
        )
    );
