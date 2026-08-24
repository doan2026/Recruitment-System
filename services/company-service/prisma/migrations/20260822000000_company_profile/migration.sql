CREATE SCHEMA IF NOT EXISTS "company";

CREATE TYPE "company"."CompanyVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "company"."CompanyMemberRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "company"."CompanyMediaType" AS ENUM ('IMAGE', 'VIDEO');

CREATE TABLE "company"."companies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(190) NOT NULL,
    "description" TEXT NOT NULL,
    "industry" VARCHAR(120) NOT NULL,
    "size" VARCHAR(50) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "website" VARCHAR(2048),
    "tax_code" VARCHAR(32) NOT NULL,
    "logo_file_id" UUID,
    "logo_url" TEXT,
    "verified_status" "company"."CompanyVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company"."company_members" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "company"."CompanyMemberRole" NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company"."company_media" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "type" "company"."CompanyMediaType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_normalized_name_key" ON "company"."companies"("normalized_name");
CREATE UNIQUE INDEX "companies_slug_key" ON "company"."companies"("slug");
CREATE UNIQUE INDEX "companies_tax_code_key" ON "company"."companies"("tax_code");
CREATE UNIQUE INDEX "company_members_user_id_key" ON "company"."company_members"("user_id");
CREATE INDEX "company_members_company_id_idx" ON "company"."company_members"("company_id");
CREATE UNIQUE INDEX "company_media_file_id_key" ON "company"."company_media"("file_id");
CREATE INDEX "company_media_company_id_sort_order_idx" ON "company"."company_media"("company_id", "sort_order");

ALTER TABLE "company"."company_members"
ADD CONSTRAINT "company_members_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "company"."companies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company"."company_media"
ADD CONSTRAINT "company_media_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "company"."companies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
