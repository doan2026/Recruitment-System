CREATE TYPE "company"."CompanyMediaAssetType" AS ENUM (
    'COMPANY_LOGO',
    'COMPANY_IMAGE',
    'COMPANY_VIDEO'
);

CREATE TYPE "company"."CompanyMediaOperationKind" AS ENUM (
    'ATTACH_COMPENSATION',
    'DETACH_CLEANUP',
    'UPLOAD_INTENT_CLEANUP'
);

ALTER TABLE "company"."companies"
ADD COLUMN "aggregate_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "logo_media_reference_id" UUID;

ALTER TABLE "company"."company_media"
ADD COLUMN "media_reference_id" UUID;

CREATE TABLE "company"."company_media_operations" (
    "id" UUID NOT NULL,
    "kind" "company"."CompanyMediaOperationKind" NOT NULL,
    "company_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "asset_type" "company"."CompanyMediaAssetType" NOT NULL,
    "reference_type" VARCHAR(64) NOT NULL,
    "reference_id" VARCHAR(128) NOT NULL,
    "local_media_id" UUID,
    "media_reference_id" UUID,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "company_media_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company"."company_media_upload_intents" (
    "file_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "asset_type" "company"."CompanyMediaAssetType" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "cleanup_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "canonical_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "company_media_upload_intents_pkey" PRIMARY KEY ("file_id")
);

CREATE UNIQUE INDEX "companies_logo_media_reference_id_key"
ON "company"."companies"("logo_media_reference_id");

CREATE UNIQUE INDEX "company_media_media_reference_id_key"
ON "company"."company_media"("media_reference_id");

CREATE INDEX "company_media_operations_next_attempt_at_idx"
ON "company"."company_media_operations"("next_attempt_at");

CREATE INDEX "company_media_operations_lease_expires_at_idx"
ON "company"."company_media_operations"("lease_expires_at");

CREATE INDEX "company_media_operations_company_id_file_id_idx"
ON "company"."company_media_operations"("company_id", "file_id");

CREATE INDEX "company_media_upload_intents_company_id_requested_by_idx"
ON "company"."company_media_upload_intents"("company_id", "requested_by");

CREATE INDEX "company_media_upload_intents_expires_at_idx"
ON "company"."company_media_upload_intents"("expires_at");

CREATE INDEX "company_media_upload_intents_cleanup_at_idx"
ON "company"."company_media_upload_intents"("cleanup_at");

ALTER TABLE "company"."company_media_upload_intents"
ADD CONSTRAINT "company_media_upload_intents_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "company"."companies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
