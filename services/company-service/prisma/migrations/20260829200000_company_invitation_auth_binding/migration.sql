ALTER TABLE "company"."company_invitations"
ADD COLUMN "email_normalization_version" SMALLINT;

UPDATE "company"."company_invitations"
SET "email_normalization_version" = 0
WHERE "status" = 'ACCEPTED';

ALTER TABLE "company"."company_invitations"
ADD CONSTRAINT "company_invitations_email_normalization_version_check"
CHECK (
  "email_normalization_version" IS NULL
  OR "email_normalization_version" IN (0, 1)
);

ALTER TABLE "company"."company_invitations"
ADD CONSTRAINT "company_invitations_accept_requires_normalized_email_check"
CHECK (
  "status" <> 'ACCEPTED'
  OR "email_normalization_version" IS NOT NULL
);
