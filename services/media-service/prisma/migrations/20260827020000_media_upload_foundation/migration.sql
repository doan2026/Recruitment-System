BEGIN;

CREATE SCHEMA IF NOT EXISTS "media";

CREATE TYPE "media"."file_owner_type" AS ENUM ('USER', 'COMPANY');
CREATE TYPE "media"."media_type" AS ENUM (
  'CV',
  'AVATAR',
  'COMPANY_LOGO',
  'COMPANY_IMAGE',
  'COMPANY_VIDEO',
  'CHAT_ATTACHMENT'
);
CREATE TYPE "media"."file_status" AS ENUM (
  'PENDING',
  'VERIFYING',
  'ACTIVE',
  'EXPIRED',
  'REJECTED',
  'DELETE_PENDING',
  'DELETE_FAILED',
  'DELETED'
);
CREATE TYPE "media"."storage_resource_type" AS ENUM ('IMAGE', 'VIDEO', 'RAW');
CREATE TYPE "media"."storage_delivery_type" AS ENUM ('UPLOAD', 'AUTHENTICATED');

CREATE TABLE "media"."file_meta" (
  "id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "producer_service" VARCHAR(64),
  "owner_id" UUID NOT NULL,
  "owner_type" "media"."file_owner_type" NOT NULL,
  "media_type" "media"."media_type" NOT NULL,
  "status" "media"."file_status" NOT NULL DEFAULT 'PENDING',
  "public_id" VARCHAR(255) NOT NULL,
  "folder" VARCHAR(128) NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "expected_format" VARCHAR(16) NOT NULL,
  "storage_resource_type" "media"."storage_resource_type" NOT NULL,
  "storage_delivery_type" "media"."storage_delivery_type" NOT NULL,
  "upload_preset" VARCHAR(128) NOT NULL,
  "idempotency_key" VARCHAR(128),
  "signature_timestamp" INTEGER NOT NULL,
  "intent_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "confirmation_attempts" INTEGER NOT NULL DEFAULT 0,
  "confirmation_retry_at" TIMESTAMPTZ(3),
  "asset_id" VARCHAR(255),
  "provider_version" VARCHAR(64),
  "canonical_url" VARCHAR(2048),
  "mime_type" VARCHAR(128),
  "format" VARCHAR(16),
  "bytes" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "duration_seconds" DOUBLE PRECISION,
  "etag" VARCHAR(128),
  "confirmed_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "aggregate_version" INTEGER NOT NULL DEFAULT 1,
  "last_error_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_meta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "file_meta_aggregate_version_check" CHECK ("aggregate_version" >= 1),
  CONSTRAINT "file_meta_confirmation_attempts_check" CHECK ("confirmation_attempts" >= 0),
  CONSTRAINT "file_meta_confirmation_retry_shape_check" CHECK (
    "confirmation_retry_at" IS NULL OR "status" = 'PENDING'
  ),
  CONSTRAINT "file_meta_filename_check" CHECK (
    char_length(btrim("original_filename")) BETWEEN 1 AND 255
    AND "original_filename" !~ '[\\/]'
    AND "original_filename" !~ '[[:cntrl:]]'
  ),
  CONSTRAINT "file_meta_folder_check" CHECK (
    ("media_type" = 'CV' AND "folder" = 'recruitment/cv')
    OR ("media_type" = 'AVATAR' AND "folder" = 'recruitment/avatar')
    OR ("media_type" = 'COMPANY_LOGO' AND "folder" = 'recruitment/company-logo')
    OR ("media_type" = 'COMPANY_IMAGE' AND "folder" = 'recruitment/company-image')
    OR ("media_type" = 'COMPANY_VIDEO' AND "folder" = 'recruitment/company-video')
    OR ("media_type" = 'CHAT_ATTACHMENT' AND "folder" = 'recruitment/chat-attachment')
  ),
  CONSTRAINT "file_meta_public_id_check" CHECK (
    "public_id" LIKE "folder" || '/%'
    AND "public_id" !~ '[[:space:]]'
    AND "public_id" !~ '\.\.'
  ),
  CONSTRAINT "file_meta_storage_policy_check" CHECK (
    ("media_type" = 'CV' AND "owner_type" = 'USER' AND "storage_resource_type" = 'RAW' AND "storage_delivery_type" = 'AUTHENTICATED')
    OR ("media_type" = 'AVATAR' AND "owner_type" = 'USER' AND "storage_resource_type" = 'IMAGE' AND "storage_delivery_type" = 'UPLOAD')
    OR ("media_type" IN ('COMPANY_LOGO', 'COMPANY_IMAGE') AND "owner_type" = 'COMPANY' AND "storage_resource_type" = 'IMAGE' AND "storage_delivery_type" = 'UPLOAD')
    OR ("media_type" = 'COMPANY_VIDEO' AND "owner_type" = 'COMPANY' AND "storage_resource_type" = 'VIDEO' AND "storage_delivery_type" = 'UPLOAD')
    OR ("media_type" = 'CHAT_ATTACHMENT' AND "owner_type" = 'USER' AND "storage_resource_type" = 'RAW' AND "storage_delivery_type" = 'AUTHENTICATED')
  ),
  CONSTRAINT "file_meta_expected_format_check" CHECK (
    ("media_type" = 'CV' AND "expected_format" = 'pdf')
    OR ("media_type" IN ('AVATAR', 'COMPANY_LOGO', 'COMPANY_IMAGE') AND "expected_format" IN ('jpg', 'png', 'webp'))
    OR ("media_type" = 'COMPANY_VIDEO' AND "expected_format" = 'mp4')
    OR ("media_type" = 'CHAT_ATTACHMENT' AND "expected_format" IN ('pdf', 'doc', 'docx', 'jpg', 'png', 'webp'))
  ),
  CONSTRAINT "file_meta_intent_expiry_check" CHECK (
    "intent_expires_at" > "created_at"
    AND "intent_expires_at" <= "created_at" + INTERVAL '10 minutes 5 seconds'
  ),
  CONSTRAINT "file_meta_dimensions_check" CHECK (
    ("width" IS NULL OR "width" > 0)
    AND ("height" IS NULL OR "height" > 0)
    AND ("duration_seconds" IS NULL OR "duration_seconds" > 0)
  ),
  CONSTRAINT "file_meta_bytes_check" CHECK ("bytes" IS NULL OR "bytes" > 0),
  CONSTRAINT "file_meta_active_shape_check" CHECK (
    "status" <> 'ACTIVE'
    OR (
      "asset_id" IS NOT NULL
      AND "provider_version" IS NOT NULL
      AND "canonical_url" ~ '^https://'
      AND "mime_type" IS NOT NULL
      AND "format" IS NOT NULL
      AND "bytes" IS NOT NULL
      AND "confirmed_at" IS NOT NULL
      AND "deleted_at" IS NULL
      AND (
        "storage_resource_type" <> 'IMAGE'
        OR (
          "width" IS NOT NULL
          AND "height" IS NOT NULL
          AND "width"::BIGINT * "height"::BIGINT <= 25000000
        )
      )
      AND ("storage_resource_type" <> 'VIDEO' OR "duration_seconds" > 0)
    )
  ),
  CONSTRAINT "file_meta_deleted_shape_check" CHECK (
    ("status" = 'DELETED' AND "deleted_at" IS NOT NULL)
    OR ("status" <> 'DELETED' AND "deleted_at" IS NULL)
  ),
  CONSTRAINT "file_meta_type_limits_check" CHECK (
    "status" <> 'ACTIVE'
    OR (
      ("media_type" = 'CV' AND "format" = 'pdf' AND "mime_type" = 'application/pdf' AND "bytes" <= 5242880)
      OR ("media_type" IN ('AVATAR', 'COMPANY_LOGO') AND "format" IN ('jpg', 'png', 'webp') AND "mime_type" IN ('image/jpeg', 'image/png', 'image/webp') AND "bytes" <= 2097152)
      OR ("media_type" = 'COMPANY_IMAGE' AND "format" IN ('jpg', 'png', 'webp') AND "mime_type" IN ('image/jpeg', 'image/png', 'image/webp') AND "bytes" <= 5242880)
      OR ("media_type" = 'COMPANY_VIDEO' AND "format" = 'mp4' AND "mime_type" = 'video/mp4' AND "bytes" <= 52428800)
      OR ("media_type" = 'CHAT_ATTACHMENT' AND "format" IN ('pdf', 'doc', 'docx', 'jpg', 'png', 'webp') AND "mime_type" IN ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp') AND "bytes" <= 10485760)
    )
  )
);

CREATE UNIQUE INDEX "file_meta_asset_id_key"
  ON "media"."file_meta" ("asset_id");
CREATE UNIQUE INDEX "file_meta_storage_identity_key"
  ON "media"."file_meta" ("storage_resource_type", "storage_delivery_type", "public_id");
CREATE UNIQUE INDEX "file_meta_request_idempotency_key"
  ON "media"."file_meta" ("requested_by", "idempotency_key");
CREATE INDEX "file_meta_requester_created_idx"
  ON "media"."file_meta" ("requested_by", "created_at");
CREATE INDEX "file_meta_owner_status_idx"
  ON "media"."file_meta" ("owner_type", "owner_id", "status");
CREATE INDEX "file_meta_status_expiry_idx"
  ON "media"."file_meta" ("status", "intent_expires_at");
CREATE INDEX "file_meta_type_status_idx"
  ON "media"."file_meta" ("media_type", "status");

CREATE TABLE "media"."file_reference" (
  "id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "caller_service" VARCHAR(64) NOT NULL,
  "reference_type" VARCHAR(64) NOT NULL,
  "reference_id" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_reference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "file_reference_service_check" CHECK ("caller_service" ~ '^[a-z][a-z0-9-]{1,63}$'),
  CONSTRAINT "file_reference_type_check" CHECK ("reference_type" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "file_reference_id_check" CHECK ("reference_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "file_reference_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "media"."file_meta" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "file_reference_identity_key"
  ON "media"."file_reference" ("file_id", "caller_service", "reference_type", "reference_id");
CREATE INDEX "file_reference_consumer_idx"
  ON "media"."file_reference" ("caller_service", "reference_type", "reference_id");

CREATE OR REPLACE FUNCTION "media"."protect_file_meta"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
    OR NEW."producer_service" IS DISTINCT FROM OLD."producer_service"
    OR NEW."owner_id" IS DISTINCT FROM OLD."owner_id"
    OR NEW."owner_type" IS DISTINCT FROM OLD."owner_type"
    OR NEW."media_type" IS DISTINCT FROM OLD."media_type"
    OR NEW."public_id" IS DISTINCT FROM OLD."public_id"
    OR NEW."folder" IS DISTINCT FROM OLD."folder"
    OR NEW."original_filename" IS DISTINCT FROM OLD."original_filename"
    OR NEW."expected_format" IS DISTINCT FROM OLD."expected_format"
    OR NEW."storage_resource_type" IS DISTINCT FROM OLD."storage_resource_type"
    OR NEW."storage_delivery_type" IS DISTINCT FROM OLD."storage_delivery_type"
    OR NEW."upload_preset" IS DISTINCT FROM OLD."upload_preset"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."signature_timestamp" IS DISTINCT FROM OLD."signature_timestamp"
    OR NEW."intent_expires_at" IS DISTINCT FROM OLD."intent_expires_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'file upload intent identity is immutable';
  END IF;

  IF NEW."aggregate_version" <> OLD."aggregate_version" + 1 THEN
    RAISE EXCEPTION 'aggregate version must increase by exactly one';
  END IF;

  IF OLD."asset_id" IS NOT NULL AND (
    NEW."asset_id" IS DISTINCT FROM OLD."asset_id"
    OR NEW."provider_version" IS DISTINCT FROM OLD."provider_version"
    OR NEW."canonical_url" IS DISTINCT FROM OLD."canonical_url"
    OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
    OR NEW."format" IS DISTINCT FROM OLD."format"
    OR NEW."bytes" IS DISTINCT FROM OLD."bytes"
    OR NEW."width" IS DISTINCT FROM OLD."width"
    OR NEW."height" IS DISTINCT FROM OLD."height"
    OR NEW."duration_seconds" IS DISTINCT FROM OLD."duration_seconds"
    OR NEW."etag" IS DISTINCT FROM OLD."etag"
    OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
  ) THEN
    RAISE EXCEPTION 'confirmed provider metadata is immutable';
  END IF;

  IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" AND NOT (
    OLD."deleted_at" IS NULL
    AND OLD."status" = 'DELETE_PENDING'
    AND NEW."status" = 'DELETED'
    AND NEW."deleted_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'deletion timestamp is immutable';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('VERIFYING', 'EXPIRED', 'DELETE_PENDING'))
    OR (OLD."status" = 'VERIFYING' AND NEW."status" IN ('PENDING', 'ACTIVE', 'EXPIRED', 'REJECTED'))
    OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'DELETE_PENDING')
    OR (OLD."status" IN ('EXPIRED', 'REJECTED', 'DELETE_FAILED') AND NEW."status" = 'DELETE_PENDING')
    OR (OLD."status" = 'DELETE_PENDING' AND NEW."status" IN ('DELETE_FAILED', 'DELETED'))
  ) THEN
    RAISE EXCEPTION 'invalid file status transition: % -> %', OLD."status", NEW."status";
  END IF;

  IF NEW."status" = 'DELETE_PENDING' AND EXISTS (
    SELECT 1 FROM "media"."file_reference" r WHERE r."file_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'file is referenced';
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "file_meta_protection_trigger"
BEFORE UPDATE ON "media"."file_meta"
FOR EACH ROW EXECUTE FUNCTION "media"."protect_file_meta"();

CREATE OR REPLACE FUNCTION "media"."prevent_file_meta_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'file metadata hard delete is disabled';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "file_meta_no_delete_trigger"
BEFORE DELETE ON "media"."file_meta"
FOR EACH ROW EXECUTE FUNCTION "media"."prevent_file_meta_delete"();

CREATE OR REPLACE FUNCTION "media"."protect_file_reference"()
RETURNS TRIGGER AS $$
DECLARE
  current_status "media"."file_status";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'file references are immutable';
  END IF;

  SELECT "status" INTO current_status
  FROM "media"."file_meta"
  WHERE "id" = NEW."file_id"
  FOR UPDATE;

  IF current_status IS NULL THEN
    RAISE EXCEPTION 'referenced file does not exist';
  END IF;
  IF current_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'only ACTIVE files can be referenced';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "file_reference_protection_trigger"
BEFORE INSERT OR UPDATE ON "media"."file_reference"
FOR EACH ROW EXECUTE FUNCTION "media"."protect_file_reference"();

COMMIT;
