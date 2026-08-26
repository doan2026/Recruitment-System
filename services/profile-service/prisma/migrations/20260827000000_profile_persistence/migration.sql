BEGIN;

CREATE SCHEMA IF NOT EXISTS "profile";

CREATE TYPE "profile"."cv_type" AS ENUM ('UPLOAD', 'ONLINE');

CREATE TABLE "profile"."profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(160),
    "headline" VARCHAR(200),
    "summary" TEXT,
    "phone" VARCHAR(32),
    "address" VARCHAR(500),
    "avatar_file_id" UUID,
    "avatar_url" VARCHAR(2048),
    "github_url" VARCHAR(2048),
    "linkedin_url" VARCHAR(2048),
    "portfolio_url" VARCHAR(2048),
    "completion_percent" INTEGER NOT NULL DEFAULT 0,
    "aggregate_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id"),
    CONSTRAINT "profiles_completion_percent_check" CHECK ("completion_percent" BETWEEN 0 AND 100),
    CONSTRAINT "profiles_aggregate_version_check" CHECK ("aggregate_version" > 0),
    CONSTRAINT "profiles_full_name_check" CHECK ("full_name" IS NULL OR ("full_name" = BTRIM("full_name") AND CHAR_LENGTH("full_name") > 0)),
    CONSTRAINT "profiles_headline_check" CHECK ("headline" IS NULL OR ("headline" = BTRIM("headline") AND CHAR_LENGTH("headline") > 0)),
    CONSTRAINT "profiles_summary_check" CHECK ("summary" IS NULL OR ("summary" = BTRIM("summary") AND CHAR_LENGTH("summary") BETWEEN 1 AND 5000)),
    CONSTRAINT "profiles_phone_check" CHECK ("phone" IS NULL OR ("phone" = BTRIM("phone") AND "phone" ~ '^[0-9+(). -]{6,32}$')),
    CONSTRAINT "profiles_address_check" CHECK ("address" IS NULL OR ("address" = BTRIM("address") AND CHAR_LENGTH("address") > 0)),
    CONSTRAINT "profiles_avatar_pair_check" CHECK (("avatar_file_id" IS NULL) = ("avatar_url" IS NULL)),
    CONSTRAINT "profiles_avatar_url_check" CHECK ("avatar_url" IS NULL OR "avatar_url" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "profiles_github_url_check" CHECK ("github_url" IS NULL OR "github_url" ~ '^https://(www[.])?github[.]com(/[^[:space:]]*)?$'),
    CONSTRAINT "profiles_linkedin_url_check" CHECK ("linkedin_url" IS NULL OR "linkedin_url" ~ '^https://(www[.])?linkedin[.]com(/[^[:space:]]*)?$'),
    CONSTRAINT "profiles_portfolio_url_check" CHECK ("portfolio_url" IS NULL OR "portfolio_url" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "profiles_timestamps_check" CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "profile"."educations" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "school" VARCHAR(200) NOT NULL,
    "major" VARCHAR(160),
    "degree" VARCHAR(120),
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "educations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "educations_school_check" CHECK ("school" = BTRIM("school") AND CHAR_LENGTH("school") > 0),
    CONSTRAINT "educations_major_check" CHECK ("major" IS NULL OR ("major" = BTRIM("major") AND CHAR_LENGTH("major") > 0)),
    CONSTRAINT "educations_degree_check" CHECK ("degree" IS NULL OR ("degree" = BTRIM("degree") AND CHAR_LENGTH("degree") > 0)),
    CONSTRAINT "educations_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
    CONSTRAINT "educations_description_check" CHECK ("description" IS NULL OR ("description" = BTRIM("description") AND CHAR_LENGTH("description") BETWEEN 1 AND 5000)),
    CONSTRAINT "educations_sort_order_check" CHECK ("sort_order" >= 0),
    CONSTRAINT "educations_timestamps_check" CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "profile"."experiences" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "company_name" VARCHAR(160) NOT NULL,
    "position" VARCHAR(160) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "experiences_company_name_check" CHECK ("company_name" = BTRIM("company_name") AND CHAR_LENGTH("company_name") > 0),
    CONSTRAINT "experiences_position_check" CHECK ("position" = BTRIM("position") AND CHAR_LENGTH("position") > 0),
    CONSTRAINT "experiences_dates_check" CHECK (("is_current" AND "end_date" IS NULL) OR (NOT "is_current" AND "end_date" IS NOT NULL AND "end_date" >= "start_date")),
    CONSTRAINT "experiences_description_check" CHECK ("description" IS NULL OR ("description" = BTRIM("description") AND CHAR_LENGTH("description") BETWEEN 1 AND 5000)),
    CONSTRAINT "experiences_sort_order_check" CHECK ("sort_order" >= 0),
    CONSTRAINT "experiences_timestamps_check" CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "profile"."skills" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "normalized_name" VARCHAR(120) NOT NULL,
    "level" VARCHAR(40),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skills_name_check" CHECK ("name" = BTRIM("name") AND CHAR_LENGTH("name") > 0),
    CONSTRAINT "skills_normalized_name_check" CHECK ("normalized_name" = LOWER(BTRIM("name")) AND CHAR_LENGTH("normalized_name") > 0),
    CONSTRAINT "skills_level_check" CHECK ("level" IS NULL OR ("level" = BTRIM("level") AND CHAR_LENGTH("level") > 0)),
    CONSTRAINT "skills_sort_order_check" CHECK ("sort_order" >= 0),
    CONSTRAINT "skills_timestamps_check" CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "profile"."certificates" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "issuer" VARCHAR(160) NOT NULL,
    "issued_at" DATE NOT NULL,
    "credential_url" VARCHAR(2048),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "certificates_name_check" CHECK ("name" = BTRIM("name") AND CHAR_LENGTH("name") > 0),
    CONSTRAINT "certificates_issuer_check" CHECK ("issuer" = BTRIM("issuer") AND CHAR_LENGTH("issuer") > 0),
    CONSTRAINT "certificates_credential_url_check" CHECK ("credential_url" IS NULL OR "credential_url" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "certificates_sort_order_check" CHECK ("sort_order" >= 0),
    CONSTRAINT "certificates_timestamps_check" CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "profile"."projects" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "role" VARCHAR(160),
    "description" TEXT,
    "url" VARCHAR(2048),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_name_check" CHECK ("name" = BTRIM("name") AND CHAR_LENGTH("name") > 0),
    CONSTRAINT "projects_role_check" CHECK ("role" IS NULL OR ("role" = BTRIM("role") AND CHAR_LENGTH("role") > 0)),
    CONSTRAINT "projects_description_check" CHECK ("description" IS NULL OR ("description" = BTRIM("description") AND CHAR_LENGTH("description") BETWEEN 1 AND 5000)),
    CONSTRAINT "projects_url_check" CHECK ("url" IS NULL OR "url" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "projects_sort_order_check" CHECK ("sort_order" >= 0),
    CONSTRAINT "projects_timestamps_check" CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "profile"."cvs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "type" "profile"."cv_type" NOT NULL,
    "file_id" UUID NOT NULL,
    "file_url" VARCHAR(2048) NOT NULL,
    "template_id" VARCHAR(100),
    "content_json" JSONB,
    "content_schema_version" INTEGER,
    "aggregate_version" INTEGER NOT NULL DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "first_used_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cvs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cvs_file_id_key" UNIQUE ("file_id"),
    CONSTRAINT "cvs_title_check" CHECK ("title" = BTRIM("title") AND CHAR_LENGTH("title") > 0),
    CONSTRAINT "cvs_file_url_check" CHECK ("file_url" ~ '^https://[^[:space:]]+$'),
    CONSTRAINT "cvs_template_id_check" CHECK ("template_id" IS NULL OR ("template_id" = BTRIM("template_id") AND CHAR_LENGTH("template_id") > 0)),
    CONSTRAINT "cvs_content_shape_check" CHECK (
        ("type" = 'UPLOAD' AND "template_id" IS NULL AND "content_json" IS NULL AND "content_schema_version" IS NULL)
        OR
        ("type" = 'ONLINE' AND "template_id" IS NOT NULL AND "content_json" IS NOT NULL AND JSONB_TYPEOF("content_json") = 'object' AND "content_schema_version" IS NOT NULL AND "content_schema_version" > 0)
    ),
    CONSTRAINT "cvs_content_size_check" CHECK ("content_json" IS NULL OR OCTET_LENGTH("content_json"::TEXT) <= 1048576),
    CONSTRAINT "cvs_aggregate_version_check" CHECK ("aggregate_version" > 0),
    CONSTRAINT "cvs_delete_state_check" CHECK ((NOT "is_deleted" AND "deleted_at" IS NULL) OR ("is_deleted" AND "deleted_at" IS NOT NULL AND NOT "is_default")),
    CONSTRAINT "cvs_first_used_at_check" CHECK ("first_used_at" IS NULL OR "first_used_at" >= "created_at"),
    CONSTRAINT "cvs_deleted_at_check" CHECK ("deleted_at" IS NULL OR "deleted_at" >= "created_at"),
    CONSTRAINT "cvs_timestamps_check" CHECK ("updated_at" >= "created_at")
);

CREATE INDEX "educations_profile_order_idx" ON "profile"."educations"("profile_id", "sort_order", "start_date");
CREATE INDEX "experiences_profile_order_idx" ON "profile"."experiences"("profile_id", "sort_order", "start_date");
CREATE UNIQUE INDEX "skills_profile_normalized_name_key" ON "profile"."skills"("profile_id", "normalized_name");
CREATE INDEX "skills_profile_order_idx" ON "profile"."skills"("profile_id", "sort_order");
CREATE INDEX "certificates_profile_order_idx" ON "profile"."certificates"("profile_id", "sort_order", "issued_at");
CREATE INDEX "projects_profile_order_idx" ON "profile"."projects"("profile_id", "sort_order");
CREATE INDEX "cvs_user_active_created_idx" ON "profile"."cvs"("user_id", "is_deleted", "created_at");
CREATE UNIQUE INDEX "cvs_one_active_default_per_user_key" ON "profile"."cvs"("user_id") WHERE "is_default" AND NOT "is_deleted";

ALTER TABLE "profile"."educations" ADD CONSTRAINT "educations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile"."experiences" ADD CONSTRAINT "experiences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile"."skills" ADD CONSTRAINT "skills_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile"."certificates" ADD CONSTRAINT "certificates_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile"."projects" ADD CONSTRAINT "projects_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile"."cvs" ADD CONSTRAINT "cvs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profile"."profiles"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "profile"."protect_profile_identity"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'profile identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "profiles_identity_immutable"
BEFORE UPDATE ON "profile"."profiles"
FOR EACH ROW EXECUTE FUNCTION "profile"."protect_profile_identity"();

CREATE FUNCTION "profile"."protect_used_cv_revision"() RETURNS TRIGGER AS $$
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
        OR NEW."template_id" IS DISTINCT FROM OLD."template_id"
        OR NEW."content_json" IS DISTINCT FROM OLD."content_json"
        OR NEW."content_schema_version" IS DISTINCT FROM OLD."content_schema_version"
    ) THEN
        RAISE EXCEPTION 'content and file of a used CV revision are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cvs_protect_used_revision_update"
BEFORE UPDATE ON "profile"."cvs"
FOR EACH ROW EXECUTE FUNCTION "profile"."protect_used_cv_revision"();

CREATE TRIGGER "cvs_protect_used_revision_delete"
BEFORE DELETE ON "profile"."cvs"
FOR EACH ROW EXECUTE FUNCTION "profile"."protect_used_cv_revision"();

COMMIT;
