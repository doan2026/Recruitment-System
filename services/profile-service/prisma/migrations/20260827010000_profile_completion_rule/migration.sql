BEGIN;

ALTER TABLE "profile"."profiles"
  ADD COLUMN "completion_rule_version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "profiles_completion_rule_version_check"
    CHECK ("completion_rule_version" >= 1);

UPDATE "profile"."profiles" AS p
SET
  "completion_rule_version" = 1,
  "completion_percent" =
    CASE WHEN p."full_name" ~ '[^[:space:]]' THEN 10 ELSE 0 END
    + CASE WHEN p."headline" ~ '[^[:space:]]' THEN 5 ELSE 0 END
    + CASE WHEN p."summary" ~ '[^[:space:]]' THEN 5 ELSE 0 END
    + CASE WHEN p."phone" ~ '[^[:space:]]' THEN 5 ELSE 0 END
    + CASE WHEN p."address" ~ '[^[:space:]]' THEN 5 ELSE 0 END
    + CASE WHEN
        p."github_url" ~ '[^[:space:]]'
        OR p."linkedin_url" ~ '[^[:space:]]'
        OR p."portfolio_url" ~ '[^[:space:]]'
      THEN 5 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM "profile"."educations" e WHERE e."profile_id" = p."id"
      ) THEN 15 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM "profile"."experiences" e WHERE e."profile_id" = p."id"
      ) THEN 20 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM "profile"."skills" s WHERE s."profile_id" = p."id"
      ) THEN 20 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM "profile"."certificates" c WHERE c."profile_id" = p."id"
      ) THEN 5 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM "profile"."projects" pr WHERE pr."profile_id" = p."id"
      ) THEN 5 ELSE 0 END;

COMMIT;
