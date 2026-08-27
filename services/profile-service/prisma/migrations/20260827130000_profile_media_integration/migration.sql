BEGIN;

ALTER TABLE "profile"."profiles"
  ADD COLUMN "avatar_media_reference_id" UUID;

ALTER TABLE "profile"."cvs"
  ADD COLUMN "media_reference_id" UUID,
  ALTER COLUMN "file_url" DROP NOT NULL;

-- Preserve the existing legacy avatar representation while allowing new
-- records to bind that exact file/url pair to an immutable Media reference.
ALTER TABLE "profile"."profiles"
  DROP CONSTRAINT IF EXISTS "profiles_avatar_pair_check";

ALTER TABLE "profile"."profiles"
  ADD CONSTRAINT "profiles_avatar_media_shape_check" CHECK (
    (
      "avatar_file_id" IS NULL
      AND "avatar_url" IS NULL
      AND "avatar_media_reference_id" IS NULL
    )
    OR
    (
      "avatar_file_id" IS NOT NULL
      AND "avatar_url" IS NOT NULL
      AND "avatar_media_reference_id" IS NULL
    )
    OR
    (
      "avatar_file_id" IS NOT NULL
      AND "avatar_url" IS NOT NULL
      AND "avatar_media_reference_id" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "profile"."profiles"
  VALIDATE CONSTRAINT "profiles_avatar_media_shape_check";

-- Legacy CVs retain their canonical HTTPS URL. New private CVs retain no
-- public URL and are resolved exclusively through Media Service.
ALTER TABLE "profile"."cvs"
  DROP CONSTRAINT IF EXISTS "cvs_file_url_check";

ALTER TABLE "profile"."cvs"
  ADD CONSTRAINT "cvs_file_url_check" CHECK (
    "file_url" IS NULL OR "file_url" ~ '^https://[^[:space:]]+$'
  ) NOT VALID,
  ADD CONSTRAINT "cvs_media_reference_shape_check" CHECK (
    (
      "file_url" IS NOT NULL
      AND "media_reference_id" IS NULL
    )
    OR
    (
      "file_url" IS NULL
      AND "media_reference_id" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "profile"."cvs"
  VALIDATE CONSTRAINT "cvs_file_url_check";

ALTER TABLE "profile"."cvs"
  VALIDATE CONSTRAINT "cvs_media_reference_shape_check";

CREATE UNIQUE INDEX "profiles_avatar_media_reference_id_key"
  ON "profile"."profiles"("avatar_media_reference_id");

CREATE UNIQUE INDEX "cvs_media_reference_id_key"
  ON "profile"."cvs"("media_reference_id");

CREATE OR REPLACE FUNCTION "profile"."protect_used_cv_revision"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'hard delete is disabled until CV usage can be verified authoritatively' USING ERRCODE = '23514';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'CV identity and ownership are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."first_used_at" IS NOT NULL AND NEW."first_used_at" IS DISTINCT FROM OLD."first_used_at" THEN
        RAISE EXCEPTION 'CV first-use marker is immutable once set' USING ERRCODE = '23514';
    END IF;
    IF (OLD."first_used_at" IS NOT NULL OR NEW."first_used_at" IS NOT NULL) AND (
        NEW."type" IS DISTINCT FROM OLD."type"
        OR NEW."file_id" IS DISTINCT FROM OLD."file_id"
        OR NEW."file_url" IS DISTINCT FROM OLD."file_url"
        OR NEW."media_reference_id" IS DISTINCT FROM OLD."media_reference_id"
        OR NEW."template_id" IS DISTINCT FROM OLD."template_id"
        OR NEW."content_json" IS DISTINCT FROM OLD."content_json"
        OR NEW."content_schema_version" IS DISTINCT FROM OLD."content_schema_version"
    ) THEN
        RAISE EXCEPTION 'content and file of a used CV revision are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
