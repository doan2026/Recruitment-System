BEGIN;

CREATE INDEX "file_meta_status_updated_idx"
  ON "media"."file_meta" ("status", "updated_at", "id");

CREATE TYPE "media"."media_cleanup_kind" AS ENUM (
  'ORPHAN_PURGE',
  'SIBLING_SWEEP',
  'FILE_DELETE'
);

CREATE TYPE "media"."media_cleanup_status" AS ENUM (
  'READY',
  'RUNNING',
  'RETRY',
  'SUCCEEDED',
  'CANCELLED'
);

CREATE TYPE "media"."media_cleanup_event_type" AS ENUM (
  'CLAIMED',
  'SUCCEEDED',
  'RETRY_SCHEDULED',
  'CANCELLED',
  'FENCE_LOST'
);

CREATE TABLE "media"."media_cleanup_job" (
  "id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "kind" "media"."media_cleanup_kind" NOT NULL,
  "status" "media"."media_cleanup_status" NOT NULL DEFAULT 'READY',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "clean_passes" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
  "lease_owner" VARCHAR(64),
  "lease_fence" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(64),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_cleanup_job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_cleanup_job_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "media"."file_meta" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_cleanup_job_attempt_check" CHECK (
    "attempt_count" >= 0 AND "lease_fence" >= 0
  ),
  CONSTRAINT "media_cleanup_job_clean_pass_check" CHECK (
    "clean_passes" BETWEEN 0 AND 2
  ),
  CONSTRAINT "media_cleanup_job_lease_shape_check" CHECK (
    (
      "status" = 'RUNNING'
      AND "lease_owner" IS NOT NULL
      AND "lease_until" IS NOT NULL
      AND "completed_at" IS NULL
    )
    OR (
      "status" <> 'RUNNING'
      AND "lease_owner" IS NULL
      AND "lease_until" IS NULL
    )
  ),
  CONSTRAINT "media_cleanup_job_terminal_shape_check" CHECK (
    (
      "status" IN ('SUCCEEDED', 'CANCELLED')
      AND "completed_at" IS NOT NULL
    )
    OR (
      "status" IN ('READY', 'RUNNING', 'RETRY')
      AND "completed_at" IS NULL
    )
  ),
  CONSTRAINT "media_cleanup_job_success_shape_check" CHECK (
    "status" <> 'SUCCEEDED' OR "clean_passes" = 2 OR "kind" = 'FILE_DELETE'
  )
);

CREATE UNIQUE INDEX "media_cleanup_job_file_kind_key"
  ON "media"."media_cleanup_job" ("file_id", "kind");
CREATE INDEX "media_cleanup_job_due_idx"
  ON "media"."media_cleanup_job" ("status", "next_attempt_at", "id");
CREATE INDEX "media_cleanup_job_lease_idx"
  ON "media"."media_cleanup_job" ("status", "lease_until", "id");

CREATE TABLE "media"."media_cleanup_event" (
  "id" BIGSERIAL NOT NULL,
  "job_id" UUID NOT NULL,
  "event_type" "media"."media_cleanup_event_type" NOT NULL,
  "attempt_count" INTEGER NOT NULL,
  "lease_fence" INTEGER NOT NULL,
  "worker_id" VARCHAR(64) NOT NULL,
  "error_code" VARCHAR(64),
  "deleted_assets" INTEGER,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_cleanup_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_cleanup_event_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "media"."media_cleanup_job" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_cleanup_event_attempt_check" CHECK (
    "attempt_count" >= 1 AND "lease_fence" >= 1
  ),
  CONSTRAINT "media_cleanup_event_deleted_assets_check" CHECK (
    "deleted_assets" IS NULL OR "deleted_assets" >= 0
  )
);

CREATE INDEX "media_cleanup_event_job_idx"
  ON "media"."media_cleanup_event" ("job_id", "id");

CREATE TABLE "media"."media_maintenance_control" (
  "name" VARCHAR(64) NOT NULL,
  "next_run_at" TIMESTAMPTZ(3) NOT NULL,
  "lease_owner" VARCHAR(64),
  "lease_fence" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_maintenance_control_pkey" PRIMARY KEY ("name"),
  CONSTRAINT "media_maintenance_control_fence_check" CHECK (
    "lease_fence" >= 0
  ),
  CONSTRAINT "media_maintenance_control_lease_shape_check" CHECK (
    ("lease_owner" IS NULL AND "lease_until" IS NULL)
    OR ("lease_owner" IS NOT NULL AND "lease_until" IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION "media"."protect_media_cleanup_job"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."file_id" IS DISTINCT FROM OLD."file_id"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'media cleanup job identity is immutable';
  END IF;

  IF OLD."status" IN ('SUCCEEDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'terminal media cleanup job is immutable';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" IN ('READY', 'RETRY') AND NEW."status" IN ('RUNNING', 'CANCELLED'))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('RETRY', 'SUCCEEDED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid media cleanup job transition: % -> %', OLD."status", NEW."status";
  END IF;

  IF NEW."status" = 'RUNNING' THEN
    IF NEW."attempt_count" <> OLD."attempt_count" + 1
      OR NEW."lease_fence" <> OLD."lease_fence" + 1
    THEN
      RAISE EXCEPTION 'cleanup claim must increment attempt and lease fence';
    END IF;
  ELSE
    IF NEW."attempt_count" <> OLD."attempt_count"
      OR NEW."lease_fence" <> OLD."lease_fence"
    THEN
      RAISE EXCEPTION 'cleanup finalize cannot change attempt or lease fence';
    END IF;
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_cleanup_job_protection_trigger"
BEFORE UPDATE ON "media"."media_cleanup_job"
FOR EACH ROW EXECUTE FUNCTION "media"."protect_media_cleanup_job"();

CREATE OR REPLACE FUNCTION "media"."prevent_media_cleanup_job_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'media cleanup job hard delete is disabled';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_cleanup_job_no_delete_trigger"
BEFORE DELETE ON "media"."media_cleanup_job"
FOR EACH ROW EXECUTE FUNCTION "media"."prevent_media_cleanup_job_delete"();

CREATE OR REPLACE FUNCTION "media"."prevent_media_cleanup_event_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'media cleanup audit event is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_cleanup_event_no_update_trigger"
BEFORE UPDATE ON "media"."media_cleanup_event"
FOR EACH ROW EXECUTE FUNCTION "media"."prevent_media_cleanup_event_mutation"();

CREATE TRIGGER "media_cleanup_event_no_delete_trigger"
BEFORE DELETE ON "media"."media_cleanup_event"
FOR EACH ROW EXECUTE FUNCTION "media"."prevent_media_cleanup_event_mutation"();

COMMIT;
