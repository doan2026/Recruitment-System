CREATE SCHEMA IF NOT EXISTS "job";
CREATE TYPE "job"."JobStatus" AS ENUM (
    'DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'CLOSED', 'EXPIRED'
);
CREATE TYPE "job"."JobType" AS ENUM (
    'FULL_TIME', 'PART_TIME', 'REMOTE', 'INTERNSHIP'
);

CREATE TABLE "job"."jobs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "benefits" TEXT NOT NULL,
    "salary_min" DECIMAL(15,2),
    "salary_max" DECIMAL(15,2),
    "is_negotiable" BOOLEAN NOT NULL DEFAULT false,
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "location" VARCHAR(255) NOT NULL,
    "job_type" "job"."JobType" NOT NULL,
    "experience_years" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "skills" TEXT[],
    "deadline" DATE NOT NULL,
    "status" "job"."JobStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "jobs_salary_range_check"
      CHECK ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_min" <= "salary_max"),
    CONSTRAINT "jobs_salary_mode_check"
      CHECK (("is_negotiable" AND "salary_min" IS NULL AND "salary_max" IS NULL)
          OR (NOT "is_negotiable" AND "salary_min" IS NOT NULL AND "salary_max" IS NOT NULL)),
    CONSTRAINT "jobs_experience_years_check" CHECK ("experience_years" >= 0),
    CONSTRAINT "jobs_quantity_check" CHECK ("quantity" > 0)
);
CREATE INDEX "jobs_company_id_status_idx" ON "job"."jobs"("company_id", "status");
CREATE INDEX "jobs_created_by_status_idx" ON "job"."jobs"("created_by", "status");
CREATE INDEX "jobs_status_deadline_idx" ON "job"."jobs"("status", "deadline");
