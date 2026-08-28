BEGIN;

CREATE TYPE "profile"."job_preference_state" AS ENUM (
    'ENABLED',
    'DISABLED'
);

CREATE TYPE "profile"."preferred_job_type" AS ENUM (
    'FULL_TIME',
    'PART_TIME',
    'REMOTE',
    'INTERNSHIP'
);

CREATE FUNCTION "profile"."job_preference_text_array_is_valid"(
    "items" TEXT[],
    "maximum_items" INTEGER,
    "maximum_length" INTEGER
) RETURNS BOOLEAN AS $$
    SELECT
        COALESCE(ARRAY_NDIMS("items"), 1) = 1
        AND CARDINALITY("items") <= "maximum_items"
        AND NOT EXISTS (
            SELECT 1
            FROM UNNEST("items") AS "item"("value")
            WHERE "value" IS NULL
               OR "value" <> BTRIM("value")
               OR CHAR_LENGTH("value") NOT BETWEEN 1 AND "maximum_length"
               OR "value" !~ '[^[:space:]]'
               OR "value" ~ '[[:cntrl:]]'
               OR POSITION('%' IN "value") > 0
               OR POSITION('_' IN "value") > 0
               OR POSITION(CHR(92) IN "value") > 0
        )
        AND CARDINALITY("items") = (
            SELECT COUNT(DISTINCT LOWER("value") COLLATE "C")
            FROM UNNEST("items") AS "item"("value")
        );
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE STRICT;

CREATE FUNCTION "profile"."job_preference_job_type_array_is_valid"(
    "items" "profile"."preferred_job_type"[]
) RETURNS BOOLEAN AS $$
    SELECT
        COALESCE(ARRAY_NDIMS("items"), 1) = 1
        AND CARDINALITY("items") <= 4
        AND NOT EXISTS (
            SELECT 1
            FROM UNNEST("items") AS "item"("value")
            WHERE "value" NOT IN (
                'FULL_TIME'::"profile"."preferred_job_type",
                'PART_TIME'::"profile"."preferred_job_type",
                'REMOTE'::"profile"."preferred_job_type",
                'INTERNSHIP'::"profile"."preferred_job_type"
            )
        )
        AND CARDINALITY("items") = (
            SELECT COUNT(DISTINCT "value")
            FROM UNNEST("items") AS "item"("value")
        );
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE STRICT;

CREATE TABLE "profile"."candidate_job_preferences" (
    "candidate_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "state" "profile"."job_preference_state" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "consent_version" INTEGER,
    "consented_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "target_roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "preferred_locations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "preferred_job_types" "profile"."preferred_job_type"[] NOT NULL
        DEFAULT ARRAY[]::"profile"."preferred_job_type"[],
    "minimum_salary" NUMERIC(15, 2),
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "candidate_job_preferences_pkey" PRIMARY KEY ("candidate_id"),
    CONSTRAINT "candidate_job_preferences_schema_version_check"
        CHECK ("schema_version" = 1),
    CONSTRAINT "candidate_job_preferences_version_check"
        CHECK ("version" BETWEEN 1 AND 2147483647),
    CONSTRAINT "candidate_job_preferences_target_roles_check"
        CHECK (
            "profile"."job_preference_text_array_is_valid"(
                "target_roles", 10, 120
            )
        ),
    CONSTRAINT "candidate_job_preferences_locations_check"
        CHECK (
            "profile"."job_preference_text_array_is_valid"(
                "preferred_locations", 5, 255
            )
        ),
    CONSTRAINT "candidate_job_preferences_job_types_check"
        CHECK (
            "profile"."job_preference_job_type_array_is_valid"(
                "preferred_job_types"
            )
        ),
    CONSTRAINT "candidate_job_preferences_salary_check"
        CHECK (
            "minimum_salary" IS NULL
            OR "minimum_salary" BETWEEN 0.01 AND 9999999999999.99
        ),
    CONSTRAINT "candidate_job_preferences_currency_check"
        CHECK ("currency" = 'VND'),
    CONSTRAINT "candidate_job_preferences_state_check" CHECK (
        (
            "state" = 'ENABLED'
            AND "consent_version" = 1
            AND "consented_at" IS NOT NULL
            AND "withdrawn_at" IS NULL
            AND (
                CARDINALITY("target_roles")
                + CARDINALITY("preferred_locations")
                + CARDINALITY("preferred_job_types") > 0
                OR "minimum_salary" IS NOT NULL
            )
        )
        OR
        (
            "state" = 'DISABLED'
            AND "consent_version" IS NULL
            AND "withdrawn_at" IS NOT NULL
            AND CARDINALITY("target_roles") = 0
            AND CARDINALITY("preferred_locations") = 0
            AND CARDINALITY("preferred_job_types") = 0
            AND "minimum_salary" IS NULL
        )
    ),
    CONSTRAINT "candidate_job_preferences_timestamps_check" CHECK (
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

ALTER TABLE "profile"."candidate_job_preferences"
    ADD CONSTRAINT "candidate_job_preferences_candidate_id_fkey"
    FOREIGN KEY ("candidate_id")
    REFERENCES "profile"."profiles"("user_id")
    ON DELETE CASCADE
    ON UPDATE RESTRICT;

CREATE FUNCTION "profile"."protect_candidate_job_preference_identity"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."candidate_id" IS DISTINCT FROM OLD."candidate_id"
       OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'candidate job preference identity is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."version" IS DISTINCT FROM OLD."version" + 1 THEN
        RAISE EXCEPTION 'candidate job preference version must increment by one'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE PLPGSQL;

CREATE TRIGGER "candidate_job_preferences_identity_and_version"
BEFORE UPDATE ON "profile"."candidate_job_preferences"
FOR EACH ROW
EXECUTE FUNCTION "profile"."protect_candidate_job_preference_identity"();

COMMIT;
