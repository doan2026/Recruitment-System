CREATE TABLE "job"."job_index_sync" (
    "job_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" VARCHAR(200),
    "lease_expires_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_index_sync_pkey" PRIMARY KEY ("job_id"),
    CONSTRAINT "job_index_sync_job_id_fkey"
      FOREIGN KEY ("job_id") REFERENCES "job"."jobs"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "job_index_sync_aggregate_version_check"
      CHECK ("aggregate_version" > 0),
    CONSTRAINT "job_index_sync_generation_check"
      CHECK ("generation" > 0),
    CONSTRAINT "job_index_sync_dispatch_attempts_check"
      CHECK ("dispatch_attempts" >= 0),
    CONSTRAINT "job_index_sync_processing_attempts_check"
      CHECK ("processing_attempts" >= 0),
    CONSTRAINT "job_index_sync_lease_check"
      CHECK (("lease_owner" IS NULL) = ("lease_expires_at" IS NULL)),
    CONSTRAINT "job_index_sync_terminal_state_check"
      CHECK ("completed_at" IS NULL OR "failed_at" IS NULL)
);

CREATE INDEX "job_index_sync_pending_idx"
    ON "job"."job_index_sync"("next_attempt_at", "updated_at")
    WHERE "completed_at" IS NULL AND "failed_at" IS NULL;

CREATE INDEX "job_index_sync_lease_expires_at_idx"
    ON "job"."job_index_sync"("lease_expires_at");

CREATE INDEX "job_index_sync_failed_at_idx"
    ON "job"."job_index_sync"("failed_at")
