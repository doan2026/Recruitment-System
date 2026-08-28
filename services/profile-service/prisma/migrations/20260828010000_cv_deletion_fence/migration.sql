BEGIN;

-- Follow the runtime aggregate lock order and keep legacy CV writers outside
-- the trigger replacement window.
LOCK TABLE "profile"."profiles" IN EXCLUSIVE MODE;
LOCK TABLE "profile"."cvs" IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "profile"."cv_deletion_state" AS ENUM (
  'PENDING_FENCE',
  'SOFT_RETAINED',
  'HARD_DELETE_AUTHORIZED',
  'HARD_DELETED'
);

CREATE TYPE "profile"."cv_media_cleanup_status" AS ENUM (
  'PENDING',
  'RUNNING',
  'RETRY',
  'SUCCEEDED'
);

CREATE TABLE "profile"."cv_deletion_workflow" (
  "cv_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "deletion_request_id" UUID NOT NULL,
  "expected_aggregate_version" INTEGER NOT NULL,
  "result_aggregate_version" INTEGER NOT NULL,
  "file_id" UUID NOT NULL,
  "media_reference_id" UUID NOT NULL,
  "replacement_default_cv_id" UUID,
  "cv_created_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3) NOT NULL,
  "state" "profile"."cv_deletion_state" NOT NULL DEFAULT 'PENDING_FENCE',
  "fenced_at" TIMESTAMPTZ(3),
  "first_used_at" TIMESTAMPTZ(3),
  "application_count" BIGINT NOT NULL DEFAULT 0,
  "fence_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "fence_next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fence_lease_owner" VARCHAR(64),
  "fence_lease_fence" INTEGER NOT NULL DEFAULT 0,
  "fence_lease_until" TIMESTAMPTZ(3),
  "last_fence_error_code" VARCHAR(96),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cv_deletion_workflow_pkey" PRIMARY KEY ("cv_id"),
  CONSTRAINT "cv_deletion_workflow_request_id_key" UNIQUE ("deletion_request_id"),
  CONSTRAINT "cv_deletion_workflow_file_id_key" UNIQUE ("file_id"),
  CONSTRAINT "cv_deletion_workflow_media_reference_id_key" UNIQUE ("media_reference_id"),
  CONSTRAINT "cv_deletion_workflow_version_check" CHECK (
    "expected_aggregate_version" > 0
    AND "result_aggregate_version" = "expected_aggregate_version" + 1
  ),
  CONSTRAINT "cv_deletion_workflow_identity_check" CHECK (
    "replacement_default_cv_id" IS NULL
    OR "replacement_default_cv_id" <> "cv_id"
  ),
  CONSTRAINT "cv_deletion_workflow_timeline_check" CHECK (
    "deleted_at" >= "cv_created_at"
    AND ("first_used_at" IS NULL OR "first_used_at" >= "cv_created_at")
  ),
  CONSTRAINT "cv_deletion_workflow_state_check" CHECK (
    (
      "state" = 'PENDING_FENCE'
      AND "fenced_at" IS NULL
      AND "first_used_at" IS NULL
      AND "application_count" = 0
    )
    OR (
      "state" = 'SOFT_RETAINED'
      AND "fenced_at" IS NULL
      AND "first_used_at" IS NOT NULL
      AND "application_count" > 0
    )
    OR (
      "state" IN ('HARD_DELETE_AUTHORIZED', 'HARD_DELETED')
      AND "fenced_at" IS NOT NULL
      AND "first_used_at" IS NULL
      AND "application_count" = 0
    )
  ),
  CONSTRAINT "cv_deletion_workflow_application_count_check" CHECK (
    "application_count" BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT "cv_deletion_workflow_fence_retry_check" CHECK (
    "fence_attempt_count" >= 0
    AND "fence_lease_fence" >= 0
    AND (
      (
        "fence_lease_owner" IS NULL
        AND "fence_lease_until" IS NULL
      )
      OR (
        "state" = 'PENDING_FENCE'
        AND "fence_lease_owner" IS NOT NULL
        AND "fence_lease_until" IS NOT NULL
      )
    )
  )
);

CREATE INDEX "cv_deletion_workflow_user_state_idx"
  ON "profile"."cv_deletion_workflow" ("user_id", "state", "created_at");

CREATE INDEX "cv_deletion_workflow_pending_due_idx"
  ON "profile"."cv_deletion_workflow" (
    (COALESCE("fence_lease_until", "fence_next_attempt_at")),
    "cv_id"
  )
  WHERE "state" = 'PENDING_FENCE';

ALTER TABLE "profile"."cv_deletion_workflow"
  ADD CONSTRAINT "cv_deletion_workflow_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "profile"."profiles"("user_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "profile"."cv_media_cleanup_job" (
  "id" UUID NOT NULL,
  "cv_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "media_reference_id" UUID NOT NULL,
  "status" "profile"."cv_media_cleanup_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" VARCHAR(64),
  "lease_fence" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMPTZ(3),
  "reference_released_at" TIMESTAMPTZ(3),
  "file_deleted_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(96),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cv_media_cleanup_job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cv_media_cleanup_job_cv_id_key" UNIQUE ("cv_id"),
  CONSTRAINT "cv_media_cleanup_job_file_id_key" UNIQUE ("file_id"),
  CONSTRAINT "cv_media_cleanup_job_reference_id_key" UNIQUE ("media_reference_id"),
  CONSTRAINT "cv_media_cleanup_job_attempt_check" CHECK (
    "attempt_count" >= 0 AND "lease_fence" >= 0
  ),
  CONSTRAINT "cv_media_cleanup_job_progress_check" CHECK (
    "file_deleted_at" IS NULL OR "reference_released_at" IS NOT NULL
  ),
  CONSTRAINT "cv_media_cleanup_job_state_check" CHECK (
    (
      "status" = 'RUNNING'
      AND "lease_owner" IS NOT NULL
      AND "lease_until" IS NOT NULL
      AND "completed_at" IS NULL
    )
    OR (
      "status" IN ('PENDING', 'RETRY')
      AND "lease_owner" IS NULL
      AND "lease_until" IS NULL
      AND "completed_at" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "lease_owner" IS NULL
      AND "lease_until" IS NULL
      AND "reference_released_at" IS NOT NULL
      AND "file_deleted_at" IS NOT NULL
      AND "completed_at" IS NOT NULL
    )
  )
);

CREATE INDEX "cv_media_cleanup_job_due_idx"
  ON "profile"."cv_media_cleanup_job" (
    "status", "next_attempt_at", "lease_until", "id"
  );

ALTER TABLE "profile"."cv_media_cleanup_job"
  ADD CONSTRAINT "cv_media_cleanup_job_cv_id_fkey"
  FOREIGN KEY ("cv_id")
  REFERENCES "profile"."cv_deletion_workflow"("cv_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "profile"."protect_cv_deletion_workflow"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'PENDING_FENCE'
       OR NEW."fenced_at" IS NOT NULL
       OR NEW."first_used_at" IS NOT NULL
       OR NEW."application_count" <> 0
       OR NEW."fence_attempt_count" <> 0
       OR NEW."fence_lease_fence" <> 0
       OR NEW."fence_lease_owner" IS NOT NULL
       OR NEW."fence_lease_until" IS NOT NULL
       OR NEW."last_fence_error_code" IS NOT NULL
       OR current_setting(
         'profile.cv_deletion_request_id',
         true
       ) IS DISTINCT FROM NEW."deletion_request_id"::text
       OR NOT EXISTS (
         SELECT 1
         FROM "profile"."cvs" AS "cv"
         WHERE "cv"."id" = NEW."cv_id"
           AND "cv"."user_id" = NEW."user_id"
           AND "cv"."file_id" = NEW."file_id"
           AND "cv"."media_reference_id" = NEW."media_reference_id"
           AND "cv"."aggregate_version" = NEW."result_aggregate_version"
           AND "cv"."created_at" = NEW."cv_created_at"
           AND "cv"."deleted_at" = NEW."deleted_at"
           AND "cv"."is_deleted"
           AND NOT "cv"."is_default"
       )
       OR (
         NEW."replacement_default_cv_id" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM "profile"."cvs" AS "replacement"
           WHERE "replacement"."id" = NEW."replacement_default_cv_id"
             AND "replacement"."user_id" = NEW."user_id"
             AND NOT "replacement"."is_deleted"
             AND "replacement"."is_default"
         )
       ) THEN
      RAISE EXCEPTION 'new CV deletion workflows must start pending'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CV deletion workflow audit rows are retained'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."cv_id" IS DISTINCT FROM OLD."cv_id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."deletion_request_id" IS DISTINCT FROM OLD."deletion_request_id"
     OR NEW."expected_aggregate_version" IS DISTINCT FROM OLD."expected_aggregate_version"
     OR NEW."result_aggregate_version" IS DISTINCT FROM OLD."result_aggregate_version"
     OR NEW."file_id" IS DISTINCT FROM OLD."file_id"
     OR NEW."media_reference_id" IS DISTINCT FROM OLD."media_reference_id"
     OR NEW."replacement_default_cv_id" IS DISTINCT FROM OLD."replacement_default_cv_id"
     OR NEW."cv_created_at" IS DISTINCT FROM OLD."cv_created_at"
     OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'CV deletion workflow identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW."state" = OLD."state"
    OR (
      OLD."state" = 'PENDING_FENCE'
      AND NEW."state" IN ('SOFT_RETAINED', 'HARD_DELETE_AUTHORIZED')
    )
    OR (
      OLD."state" = 'HARD_DELETE_AUTHORIZED'
      AND NEW."state" = 'HARD_DELETED'
    )
  ) THEN
    RAISE EXCEPTION 'invalid CV deletion workflow transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."state" = 'PENDING_FENCE'
     AND NEW."state" = 'HARD_DELETE_AUTHORIZED'
     AND current_setting(
       'profile.cv_deletion_request_id',
       true
     ) IS DISTINCT FROM NEW."deletion_request_id"::text THEN
    RAISE EXCEPTION 'CV deletion authorization requires its transaction fence'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."state" = 'HARD_DELETE_AUTHORIZED'
     AND NEW."state" = 'HARD_DELETED'
     AND (
       current_setting(
         'profile.cv_deletion_request_id',
         true
       ) IS DISTINCT FROM NEW."deletion_request_id"::text
       OR
       EXISTS (
         SELECT 1
         FROM "profile"."cvs" AS "cv"
         WHERE "cv"."id" = OLD."cv_id"
       )
       OR NOT EXISTS (
         SELECT 1
         FROM "profile"."cv_media_cleanup_job" AS "cleanup"
         WHERE "cleanup"."cv_id" = OLD."cv_id"
           AND "cleanup"."user_id" = OLD."user_id"
           AND "cleanup"."file_id" = OLD."file_id"
           AND "cleanup"."media_reference_id" = OLD."media_reference_id"
       )
     ) THEN
    RAISE EXCEPTION 'hard-deleted workflow requires a deleted CV and cleanup job'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."state" <> 'PENDING_FENCE'
     AND (
       NEW."fenced_at" IS DISTINCT FROM OLD."fenced_at"
       OR NEW."first_used_at" IS DISTINCT FROM OLD."first_used_at"
       OR NEW."application_count" IS DISTINCT FROM OLD."application_count"
     ) THEN
    RAISE EXCEPTION 'CV deletion decision evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cv_deletion_workflow_protection"
BEFORE INSERT OR UPDATE OR DELETE ON "profile"."cv_deletion_workflow"
FOR EACH ROW
EXECUTE FUNCTION "profile"."protect_cv_deletion_workflow"();

-- HARD_DELETE_AUTHORIZED is an in-transaction capability, never a durable
-- saga state. The deferred trigger observes the final row, so the legitimate
-- authorize -> cleanup outbox -> CV delete -> HARD_DELETED transaction passes
-- while a partial authorization cannot commit.
CREATE OR REPLACE FUNCTION "profile"."reject_durable_cv_delete_authorization"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "profile"."cv_deletion_workflow" AS "workflow"
    WHERE "workflow"."cv_id" = NEW."cv_id"
      AND "workflow"."state" = 'HARD_DELETE_AUTHORIZED'
  ) THEN
    RAISE EXCEPTION 'CV hard-delete authorization cannot be committed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "cv_deletion_workflow_no_durable_authorization"
AFTER INSERT OR UPDATE ON "profile"."cv_deletion_workflow"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "profile"."reject_durable_cv_delete_authorization"();

CREATE OR REPLACE FUNCTION "profile"."protect_cv_media_cleanup_job"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING'
       OR NEW."attempt_count" <> 0
       OR NEW."lease_fence" <> 0
       OR NEW."lease_owner" IS NOT NULL
       OR NEW."lease_until" IS NOT NULL
       OR NEW."reference_released_at" IS NOT NULL
       OR NEW."file_deleted_at" IS NOT NULL
       OR NEW."completed_at" IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM "profile"."cv_deletion_workflow" AS "workflow"
         WHERE "workflow"."cv_id" = NEW."cv_id"
           AND "workflow"."user_id" = NEW."user_id"
           AND "workflow"."file_id" = NEW."file_id"
           AND "workflow"."media_reference_id" = NEW."media_reference_id"
           AND "workflow"."state" IN (
             'HARD_DELETE_AUTHORIZED',
             'HARD_DELETED'
           )
       ) THEN
      RAISE EXCEPTION 'new CV Media cleanup jobs must start pending'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CV Media cleanup jobs are retained'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."cv_id" IS DISTINCT FROM OLD."cv_id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."file_id" IS DISTINCT FROM OLD."file_id"
     OR NEW."media_reference_id" IS DISTINCT FROM OLD."media_reference_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."attempt_count" < OLD."attempt_count"
     OR NEW."lease_fence" < OLD."lease_fence"
     OR (
       OLD."reference_released_at" IS NOT NULL
       AND NEW."reference_released_at" IS DISTINCT FROM OLD."reference_released_at"
     )
     OR (
       OLD."file_deleted_at" IS NOT NULL
       AND NEW."file_deleted_at" IS DISTINCT FROM OLD."file_deleted_at"
     )
     OR (
       OLD."completed_at" IS NOT NULL
       AND NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
     ) THEN
    RAISE EXCEPTION 'CV Media cleanup identity and completed progress are immutable'
      USING ERRCODE = '23514';
  END IF;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cv_media_cleanup_job_protection"
BEFORE INSERT OR UPDATE OR DELETE ON "profile"."cv_media_cleanup_job"
FOR EACH ROW
EXECUTE FUNCTION "profile"."protect_cv_media_cleanup_job"();

-- Published snapshots remain immutable. A physical delete is allowed only
-- after an Application-owned fence has been durably mirrored into the exact
-- local workflow, and only for a soft-deleted leaf that was never used.
CREATE OR REPLACE FUNCTION "profile"."protect_used_cv_revision"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT OLD."is_deleted"
       OR OLD."is_default"
       OR OLD."first_used_at" IS NOT NULL
       OR OLD."media_reference_id" IS NULL
       OR EXISTS (
         SELECT 1
         FROM "profile"."cvs" AS "successor"
         WHERE "successor"."previous_revision_id" = OLD."id"
            OR (
              "successor"."revision_series_id" = OLD."id"
              AND "successor"."id" <> OLD."id"
            )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM "profile"."cv_deletion_workflow" AS "workflow"
         WHERE "workflow"."cv_id" = OLD."id"
           AND "workflow"."user_id" = OLD."user_id"
           AND "workflow"."file_id" = OLD."file_id"
           AND "workflow"."media_reference_id" = OLD."media_reference_id"
           AND "workflow"."result_aggregate_version" = OLD."aggregate_version"
           AND "workflow"."state" = 'HARD_DELETE_AUTHORIZED'
           AND "workflow"."fenced_at" IS NOT NULL
           AND current_setting(
             'profile.cv_deletion_request_id',
             true
           ) = "workflow"."deletion_request_id"::text
           AND EXISTS (
             SELECT 1
             FROM "profile"."cv_media_cleanup_job" AS "cleanup"
             WHERE "cleanup"."cv_id" = OLD."id"
               AND "cleanup"."user_id" = OLD."user_id"
               AND "cleanup"."file_id" = OLD."file_id"
               AND "cleanup"."media_reference_id" = OLD."media_reference_id"
               AND "cleanup"."status" = 'PENDING'
           )
       ) THEN
      RAISE EXCEPTION 'hard delete requires an authoritative CV deletion fence'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
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
  IF OLD."is_deleted" AND NOT NEW."is_deleted" THEN
    RAISE EXCEPTION 'a deleted CV cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."deleted_at" IS NOT NULL
     AND NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
    RAISE EXCEPTION 'CV deletion timestamp is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  IF NOT OLD."is_deleted" AND NEW."is_deleted"
     AND (
       NEW."deleted_at" IS NULL
       OR NEW."is_default"
       OR NEW."deleted_at" < NEW."created_at"
     ) THEN
    RAISE EXCEPTION 'invalid CV soft-delete transition'
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

CREATE OR REPLACE FUNCTION "profile"."reject_retired_cv_file"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "profile"."cv_deletion_workflow" AS "workflow"
    WHERE "workflow"."file_id" = NEW."file_id"
  ) THEN
    RAISE EXCEPTION 'a retired CV file cannot be registered again'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cvs_reject_retired_file"
BEFORE INSERT ON "profile"."cvs"
FOR EACH ROW
EXECUTE FUNCTION "profile"."reject_retired_cv_file"();

COMMIT;
