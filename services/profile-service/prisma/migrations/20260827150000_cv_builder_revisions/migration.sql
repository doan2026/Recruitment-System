BEGIN;

-- Follow the runtime Profile -> CV lock order and close the legacy-writer
-- window before lineage is backfilled and enforced.
LOCK TABLE "profile"."profiles" IN EXCLUSIVE MODE;
LOCK TABLE "profile"."cvs" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "profile"."cvs"
  ADD COLUMN "revision_series_id" UUID,
  ADD COLUMN "revision_number" INTEGER,
  ADD COLUMN "previous_revision_id" UUID;

-- Every existing CV becomes the immutable root of its own revision series.
-- This is technical lineage metadata only, so aggregate versions stay intact.
UPDATE "profile"."cvs"
SET
  "revision_series_id" = "id",
  "revision_number" = 1;

-- The backfill fires the existing deferred exact-default trigger. Drain those
-- events before the following ALTER TABLE statements; PostgreSQL deliberately
-- refuses table rewrites while deferred trigger events are still pending.
SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE;

ALTER TABLE "profile"."cvs"
  ADD CONSTRAINT "cvs_revision_lineage_check" CHECK (
    "revision_series_id" IS NOT NULL
    AND "revision_number" IS NOT NULL
    AND "revision_number" > 0
    AND (
      (
        "revision_number" = 1
        AND "previous_revision_id" IS NULL
        AND "revision_series_id" = "id"
      )
      OR
      (
        "type" = 'ONLINE'
        AND "revision_number" > 1
        AND "previous_revision_id" IS NOT NULL
        AND "revision_series_id" <> "id"
      )
    )
  ) NOT VALID;

ALTER TABLE "profile"."cvs"
  VALIDATE CONSTRAINT "cvs_revision_lineage_check";

CREATE UNIQUE INDEX "cvs_previous_revision_id_key"
  ON "profile"."cvs"("previous_revision_id");

CREATE UNIQUE INDEX "cvs_revision_series_number_key"
  ON "profile"."cvs"("revision_series_id", "revision_number");

-- A logical CV has at most one active published revision. Revision handover
-- soft-deletes the predecessor before inserting its successor in one local
-- transaction, so readers never observe a half-completed state.
CREATE UNIQUE INDEX "cvs_one_active_revision_per_series_key"
  ON "profile"."cvs"("user_id", "revision_series_id")
  WHERE NOT "is_deleted";

CREATE INDEX "cvs_user_revision_series_idx"
  ON "profile"."cvs"(
    "user_id",
    "revision_series_id",
    "revision_number"
  );

ALTER TABLE "profile"."cvs"
  ADD CONSTRAINT "cvs_revision_series_id_fkey"
    FOREIGN KEY ("revision_series_id")
    REFERENCES "profile"."cvs"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
    NOT VALID,
  ADD CONSTRAINT "cvs_previous_revision_id_fkey"
    FOREIGN KEY ("previous_revision_id")
    REFERENCES "profile"."cvs"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
    NOT VALID;

ALTER TABLE "profile"."cvs"
  VALIDATE CONSTRAINT "cvs_revision_series_id_fkey";

ALTER TABLE "profile"."cvs"
  VALIDATE CONSTRAINT "cvs_previous_revision_id_fkey";

-- Backward-compatible root initialization keeps existing upload writers valid
-- while all newly published rows receive immutable lineage metadata.
CREATE OR REPLACE FUNCTION "profile"."initialize_cv_revision_root"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."revision_series_id" IS NULL
     AND NEW."revision_number" IS NULL
     AND NEW."previous_revision_id" IS NULL THEN
    NEW."revision_series_id" := NEW."id";
    NEW."revision_number" := 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cvs_initialize_revision_root"
BEFORE INSERT ON "profile"."cvs"
FOR EACH ROW
EXECUTE FUNCTION "profile"."initialize_cv_revision_root"();

CREATE OR REPLACE FUNCTION "profile"."validate_cv_revision_successor"()
RETURNS TRIGGER AS $$
DECLARE
  "previous" "profile"."cvs"%ROWTYPE;
BEGIN
  IF NEW."revision_number" = 1 THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO "previous"
  FROM "profile"."cvs"
  WHERE "id" = NEW."previous_revision_id"
  FOR KEY SHARE;

  IF NOT FOUND
     OR NEW."type" <> 'ONLINE'
     OR "previous"."type" <> 'ONLINE'
     OR NOT "previous"."is_deleted"
     OR "previous"."user_id" IS DISTINCT FROM NEW."user_id"
     OR "previous"."revision_series_id" IS DISTINCT FROM NEW."revision_series_id"
     OR "previous"."revision_number" + 1 <> NEW."revision_number" THEN
    RAISE EXCEPTION 'invalid CV revision predecessor'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cvs_validate_revision_successor"
BEFORE INSERT ON "profile"."cvs"
FOR EACH ROW
EXECUTE FUNCTION "profile"."validate_cv_revision_successor"();

-- Published CV rows are immutable snapshots. This is deliberately stronger
-- than first_used_at because a separate usage lookup cannot close the race
-- with a concurrent Application submission in another database.
CREATE OR REPLACE FUNCTION "profile"."protect_used_cv_revision"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hard delete is disabled until CV usage can be verified authoritatively'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."revision_series_id" IS DISTINCT FROM OLD."revision_series_id"
     OR NEW."revision_number" IS DISTINCT FROM OLD."revision_number"
     OR NEW."previous_revision_id" IS DISTINCT FROM OLD."previous_revision_id" THEN
    RAISE EXCEPTION 'CV identity and ownership are immutable; revision lineage is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."first_used_at" IS NOT NULL
     AND NEW."first_used_at" IS DISTINCT FROM OLD."first_used_at" THEN
    RAISE EXCEPTION 'CV first-use marker is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."file_id" IS DISTINCT FROM OLD."file_id"
     OR NEW."file_url" IS DISTINCT FROM OLD."file_url"
     OR NEW."media_reference_id" IS DISTINCT FROM OLD."media_reference_id"
     OR NEW."template_id" IS DISTINCT FROM OLD."template_id"
     OR NEW."content_json" IS DISTINCT FROM OLD."content_json"
     OR NEW."content_schema_version" IS DISTINCT FROM OLD."content_schema_version" THEN
    RAISE EXCEPTION 'CV snapshot content and file are immutable; create a new revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
