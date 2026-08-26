CREATE SEQUENCE auth.registration_flow_fence_seq;

ALTER TABLE auth.users
    ADD COLUMN registration_id UUID,
    ADD COLUMN registration_fence BIGINT NOT NULL DEFAULT 0;

-- V1 allowed pending rows before the registration-flow contract existed. Give every
-- pending row a one-time flow identity so the upgrade remains valid and deterministic.
UPDATE auth.users
SET registration_id = gen_random_uuid()
WHERE is_verified = FALSE
  AND registration_id IS NULL;

ALTER TABLE auth.users
    ADD CONSTRAINT ck_users_registration_flow CHECK (
        registration_fence >= 0
        AND (
            (is_verified = FALSE AND registration_id IS NOT NULL)
            OR (is_verified = TRUE AND registration_id IS NULL)
        )
    );

CREATE UNIQUE INDEX uq_users_registration_id
    ON auth.users (registration_id)
    WHERE registration_id IS NOT NULL;
