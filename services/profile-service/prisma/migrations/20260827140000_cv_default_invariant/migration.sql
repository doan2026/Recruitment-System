BEGIN;

-- Match the runtime Profile -> CV lock order. EXCLUSIVE still permits plain
-- ACCESS SHARE reads, but blocks SELECT FOR UPDATE and all Profile writers
-- before the migration takes the CV writer fence.
LOCK TABLE "profile"."profiles" IN EXCLUSIVE MODE;

-- Close the writer race between the legacy backfill and trigger installation.
-- CV readers keep ACCESS SHARE, while INSERT/UPDATE/DELETE wait until the
-- invariant and its deferred trigger are committed together.
LOCK TABLE "profile"."cvs" IN SHARE ROW EXCLUSIVE MODE;

-- Older rows were allowed to have active CVs without a default. Pick exactly
-- one for each affected candidate without changing an existing valid choice.
-- The UUID tie-breaker makes the result stable even when timestamps are equal.
WITH "ranked_missing_defaults" AS (
  SELECT
    "cv"."id",
    ROW_NUMBER() OVER (
      PARTITION BY "cv"."user_id"
      ORDER BY "cv"."created_at" DESC, "cv"."id" ASC
    ) AS "default_rank"
  FROM "profile"."cvs" AS "cv"
  WHERE NOT "cv"."is_deleted"
    AND NOT EXISTS (
      SELECT 1
      FROM "profile"."cvs" AS "existing_default"
      WHERE "existing_default"."user_id" = "cv"."user_id"
        AND NOT "existing_default"."is_deleted"
        AND "existing_default"."is_default"
    )
),
"backfilled_defaults" AS (
  UPDATE "profile"."cvs" AS "cv"
  SET
    "is_default" = true,
    "aggregate_version" = "cv"."aggregate_version" + 1,
    "updated_at" = GREATEST("cv"."updated_at", CURRENT_TIMESTAMP)
  FROM "ranked_missing_defaults" AS "ranked"
  WHERE "cv"."id" = "ranked"."id"
    AND "ranked"."default_rank" = 1
  RETURNING "cv"."user_id"
),
"affected_profiles" AS (
  SELECT DISTINCT "user_id"
  FROM "backfilled_defaults"
)
UPDATE "profile"."profiles" AS "profile"
SET
  "aggregate_version" = "profile"."aggregate_version" + 1,
  "updated_at" = GREATEST("profile"."updated_at", CURRENT_TIMESTAMP)
FROM "affected_profiles" AS "affected"
WHERE "profile"."user_id" = "affected"."user_id";

CREATE OR REPLACE FUNCTION "profile"."enforce_cv_default_invariant"()
RETURNS TRIGGER AS $$
DECLARE
  "affected_user_id" UUID;
  "active_count" BIGINT;
  "default_count" BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    "affected_user_id" := OLD."user_id";
  ELSE
    "affected_user_id" := NEW."user_id";
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT "is_deleted"),
    COUNT(*) FILTER (WHERE "is_default")
  INTO "active_count", "default_count"
  FROM "profile"."cvs"
  WHERE "user_id" = "affected_user_id";

  IF ("active_count" = 0 AND "default_count" <> 0)
     OR ("active_count" > 0 AND "default_count" <> 1) THEN
    RAISE EXCEPTION 'an active CV set must have exactly one default'
      USING
        ERRCODE = '23514',
        DETAIL = FORMAT(
          'user_id=%s active_count=%s default_count=%s',
          "affected_user_id",
          "active_count",
          "default_count"
        );
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The existing partial unique index rejects two active defaults immediately.
-- This deferred constraint adds the complementary "at least one" rule while
-- allowing a transaction to clear the old default before assigning the next.
DROP TRIGGER IF EXISTS "cvs_default_invariant_deferred"
  ON "profile"."cvs";

CREATE CONSTRAINT TRIGGER "cvs_default_invariant_deferred"
AFTER INSERT OR UPDATE OR DELETE ON "profile"."cvs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "profile"."enforce_cv_default_invariant"();

-- Fail the migration rather than installing the trigger over unexpected
-- legacy drift. The delete-state CHECK already prevents deleted defaults, and
-- the partial unique index already prevents more than one active default.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "profile"."cvs"
    GROUP BY "user_id"
    HAVING
      COUNT(*) FILTER (WHERE NOT "is_deleted") > 0
      AND COUNT(*) FILTER (WHERE NOT "is_deleted" AND "is_default") <> 1
  ) OR EXISTS (
    SELECT 1
    FROM "profile"."cvs"
    WHERE "is_deleted" AND "is_default"
  ) THEN
    RAISE EXCEPTION 'cannot install CV default invariant over invalid data'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
