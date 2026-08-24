ALTER TABLE "job"."jobs"
    ADD COLUMN "rejection_reason" VARCHAR(1000),
    ADD COLUMN "reviewed_by" UUID,
    ADD COLUMN "reviewed_at" TIMESTAMPTZ(3);
