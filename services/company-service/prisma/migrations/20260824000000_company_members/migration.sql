CREATE TYPE "company"."CompanyInvitationStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'REVOKED',
    'EXPIRED'
);

CREATE TABLE "company"."company_invitations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "normalized_email" VARCHAR(320) NOT NULL,
    "status" "company"."CompanyInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "token_hash" CHAR(64) NOT NULL,
    "invited_by" UUID NOT NULL,
    "accepted_by" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_invitations_token_hash_key"
ON "company"."company_invitations"("token_hash");
CREATE UNIQUE INDEX "company_invitations_company_id_normalized_email_key"
ON "company"."company_invitations"("company_id", "normalized_email");
CREATE INDEX "company_invitations_company_id_status_idx"
ON "company"."company_invitations"("company_id", "status");
CREATE INDEX "company_invitations_expires_at_idx"
ON "company"."company_invitations"("expires_at");

ALTER TABLE "company"."company_invitations"
ADD CONSTRAINT "company_invitations_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "company"."companies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
