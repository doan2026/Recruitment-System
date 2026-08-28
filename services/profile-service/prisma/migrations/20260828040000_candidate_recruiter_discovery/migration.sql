BEGIN;

CREATE TYPE "profile"."recruiter_discovery_state" AS ENUM (
    'ENABLED',
    'DISABLED'
);

CREATE TABLE "profile"."candidate_recruiter_discovery" (
    "candidate_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "state" "profile"."recruiter_discovery_state" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "consent_version" INTEGER,
    "cv_id" UUID,
    "consented_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "candidate_recruiter_discovery_pkey"
        PRIMARY KEY ("candidate_id"),
    CONSTRAINT "candidate_recruiter_discovery_schema_version_check"
        CHECK ("schema_version" = 1),
    CONSTRAINT "candidate_recruiter_discovery_version_check"
        CHECK ("version" BETWEEN 1 AND 2147483647),
    CONSTRAINT "candidate_recruiter_discovery_state_check" CHECK (
        (
            "state" = 'ENABLED'
            AND "consent_version" = 1
            AND "cv_id" IS NOT NULL
            AND "consented_at" IS NOT NULL
            AND "withdrawn_at" IS NULL
        )
        OR
        (
            "state" = 'DISABLED'
            AND "consent_version" IS NULL
            AND "cv_id" IS NULL
            AND "withdrawn_at" IS NOT NULL
        )
    ),
    CONSTRAINT "candidate_recruiter_discovery_timestamps_check" CHECK (
        "updated_at" >= "created_at"
        AND (
            "consented_at" IS NULL
            OR (
                "consented_at" >= "created_at"
                AND "consented_at" <= "updated_at"
            )
        )
        AND (
            "withdrawn_at" IS NULL
            OR (
                "withdrawn_at" >= "created_at"
                AND "withdrawn_at" <= "updated_at"
                AND (
                    "consented_at" IS NULL
                    OR "withdrawn_at" >= "consented_at"
                )
            )
        )
    )
);

ALTER TABLE "profile"."candidate_recruiter_discovery"
    ADD CONSTRAINT "candidate_recruiter_discovery_candidate_id_fkey"
    FOREIGN KEY ("candidate_id")
    REFERENCES "profile"."profiles"("user_id")
    ON DELETE CASCADE
    ON UPDATE RESTRICT;

CREATE INDEX "candidate_recruiter_discovery_state_candidate_idx"
    ON "profile"."candidate_recruiter_discovery" (
        "state", "candidate_id"
    );

CREATE FUNCTION "profile"."protect_candidate_recruiter_discovery"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."candidate_id" IS DISTINCT FROM OLD."candidate_id"
       OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'candidate recruiter discovery identity is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."version" IS DISTINCT FROM OLD."version" + 1 THEN
        RAISE EXCEPTION 'candidate recruiter discovery version must increment by one'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE PLPGSQL;

CREATE TRIGGER "candidate_recruiter_discovery_identity_and_version"
BEFORE UPDATE ON "profile"."candidate_recruiter_discovery"
FOR EACH ROW
EXECUTE FUNCTION "profile"."protect_candidate_recruiter_discovery"();

COMMENT ON COLUMN "profile"."candidate_recruiter_discovery"."cv_id" IS
    'No CV foreign key by design: every discovery read joins an active owned private CV and stale references fail closed.';

COMMIT;
