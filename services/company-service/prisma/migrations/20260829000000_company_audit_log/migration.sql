BEGIN;

CREATE TYPE "company"."CompanyAuditAction" AS ENUM (
    'VERIFICATION_APPROVED',
    'VERIFICATION_REJECTED',
    'OWNERSHIP_TRANSFERRED'
);

CREATE TABLE "company"."company_audit_logs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "action" "company"."CompanyAuditAction" NOT NULL,
    "actor_id" UUID NOT NULL,
    "target_user_id" UUID,
    "resulting_aggregate_version" INTEGER NOT NULL,
    "from_verification_status" "company"."CompanyVerificationStatus",
    "to_verification_status" "company"."CompanyVerificationStatus",
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "company_audit_logs_positive_version_check"
        CHECK ("resulting_aggregate_version" > 0),
    CONSTRAINT "company_audit_logs_action_shape_check" CHECK (
        (
            "action" = 'VERIFICATION_APPROVED'
            AND "target_user_id" IS NULL
            AND "from_verification_status" IS NOT DISTINCT FROM 'PENDING'
            AND "to_verification_status" IS NOT DISTINCT FROM 'VERIFIED'
            AND "reason" IS NULL
        )
        OR
        (
            "action" = 'VERIFICATION_REJECTED'
            AND "target_user_id" IS NULL
            AND "from_verification_status" IS NOT DISTINCT FROM 'PENDING'
            AND "to_verification_status" IS NOT DISTINCT FROM 'REJECTED'
            AND "reason" IS NOT NULL
            AND "reason" ~ '[^[:space:]]'
        )
        OR
        (
            "action" = 'OWNERSHIP_TRANSFERRED'
            AND "target_user_id" IS NOT NULL
            AND "actor_id" <> "target_user_id"
            AND "from_verification_status" IS NULL
            AND "to_verification_status" IS NULL
            AND "reason" IS NULL
        )
    )
);

CREATE UNIQUE INDEX "company_members_one_owner_per_company_key"
ON "company"."company_members"("company_id")
WHERE "role" = 'OWNER';

CREATE INDEX "company_audit_logs_company_id_created_at_id_idx"
ON "company"."company_audit_logs"("company_id", "created_at", "id");

CREATE INDEX "company_audit_logs_actor_id_created_at_idx"
ON "company"."company_audit_logs"("actor_id", "created_at");

CREATE UNIQUE INDEX "company_audit_logs_company_id_resulting_aggregate_version_key"
ON "company"."company_audit_logs"("company_id", "resulting_aggregate_version");

ALTER TABLE "company"."company_audit_logs"
ADD CONSTRAINT "company_audit_logs_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "company"."companies"("id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "company"."reject_company_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'company audit logs are append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "company_audit_logs_reject_update_delete"
BEFORE UPDATE OR DELETE ON "company"."company_audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "company"."reject_company_audit_log_mutation"();

CREATE TRIGGER "company_audit_logs_reject_truncate"
BEFORE TRUNCATE ON "company"."company_audit_logs"
FOR EACH STATEMENT
EXECUTE FUNCTION "company"."reject_company_audit_log_mutation"();

COMMIT;
