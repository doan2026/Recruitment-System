BEGIN;

CREATE TYPE "profile"."cv_event_action" AS ENUM (
  'UPSERTED',
  'DEACTIVATED',
  'DELETED'
);

CREATE TABLE "profile"."cv_event_outbox" (
  "event_id" UUID NOT NULL,
  "cv_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "cv_type" "profile"."cv_type" NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "action" "profile"."cv_event_action" NOT NULL,
  "topic" VARCHAR(100) NOT NULL DEFAULT 'cv-events',
  "event_key" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" VARCHAR(64),
  "lease_fence" INTEGER NOT NULL DEFAULT 0,
  "lease_expires_at" TIMESTAMPTZ(3),
  "published_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(96),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cv_event_outbox_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "cv_event_outbox_cv_version_key"
    UNIQUE ("cv_id", "aggregate_version"),
  CONSTRAINT "cv_event_outbox_version_check"
    CHECK ("aggregate_version" > 0),
  CONSTRAINT "cv_event_outbox_attempt_check"
    CHECK ("attempts" >= 0 AND "lease_fence" >= 0),
  CONSTRAINT "cv_event_outbox_event_key_check"
    CHECK ("event_key" = "cv_id"),
  CONSTRAINT "cv_event_outbox_topic_check"
    CHECK (
      length("topic") BETWEEN 1 AND 100
      AND "topic" ~ '^[A-Za-z0-9._-]+$'
      AND "topic" NOT IN ('.', '..')
    ),
  CONSTRAINT "cv_event_outbox_lease_check"
    CHECK (("lease_owner" IS NULL) = ("lease_expires_at" IS NULL)),
  CONSTRAINT "cv_event_outbox_published_lease_check"
    CHECK (
      "published_at" IS NULL
      OR ("lease_owner" IS NULL AND "lease_expires_at" IS NULL)
    ),
  CONSTRAINT "cv_event_outbox_error_code_check"
    CHECK (
      "last_error_code" IS NULL
      OR "last_error_code" ~ '^[A-Z][A-Z0-9_]{1,95}$'
    ),
  CONSTRAINT "cv_event_outbox_payload_shape_check"
    CHECK (
      jsonb_typeof("payload") = 'object'
      AND "payload" ?& ARRAY[
        'event_id',
        'action',
        'cv_id',
        'candidate_id',
        'file_id',
        'cv_type',
        'occurred_at',
        'schema_version',
        'aggregate_version'
      ]
      AND (
        "payload" - ARRAY[
          'event_id',
          'action',
          'cv_id',
          'candidate_id',
          'file_id',
          'cv_type',
          'occurred_at',
          'schema_version',
          'aggregate_version'
        ]
      ) = '{}'::jsonb
      AND jsonb_typeof("payload"->'event_id') = 'string'
      AND jsonb_typeof("payload"->'action') = 'string'
      AND jsonb_typeof("payload"->'cv_id') = 'string'
      AND jsonb_typeof("payload"->'candidate_id') = 'string'
      AND jsonb_typeof("payload"->'file_id') = 'string'
      AND jsonb_typeof("payload"->'cv_type') = 'string'
      AND jsonb_typeof("payload"->'occurred_at') = 'string'
      AND "payload"->>'occurred_at' ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      AND "payload"->'schema_version' = '1'::jsonb
      AND jsonb_typeof("payload"->'aggregate_version') = 'number'
      AND "payload"->>'event_id' = "event_id"::text
      AND "payload"->>'action' = "action"::text
      AND "payload"->>'cv_id' = "cv_id"::text
      AND "payload"->>'candidate_id' = "candidate_id"::text
      AND "payload"->>'file_id' = "file_id"::text
      AND "payload"->>'cv_type' = "cv_type"::text
      AND "payload"->>'aggregate_version' = "aggregate_version"::text
    )
);

CREATE INDEX "cv_event_outbox_pending_due_idx"
  ON "profile"."cv_event_outbox" (
    "next_attempt_at", "created_at", "event_id"
  )
  WHERE "published_at" IS NULL;

CREATE INDEX "cv_event_outbox_lease_expires_at_idx"
  ON "profile"."cv_event_outbox" ("lease_expires_at");

CREATE INDEX "cv_event_outbox_published_at_idx"
  ON "profile"."cv_event_outbox" ("published_at")
  WHERE "published_at" IS NOT NULL;

CREATE FUNCTION "profile"."protect_cv_event_outbox"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published CV event outbox rows are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF ROW(
    NEW."event_id",
    NEW."cv_id",
    NEW."candidate_id",
    NEW."file_id",
    NEW."cv_type",
    NEW."aggregate_version",
    NEW."action",
    NEW."topic",
    NEW."event_key",
    NEW."payload",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."event_id",
    OLD."cv_id",
    OLD."candidate_id",
    OLD."file_id",
    OLD."cv_type",
    OLD."aggregate_version",
    OLD."action",
    OLD."topic",
    OLD."event_key",
    OLD."payload",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'CV event outbox identity and payload are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "cv_event_outbox_immutable"
BEFORE UPDATE ON "profile"."cv_event_outbox"
FOR EACH ROW
EXECUTE FUNCTION "profile"."protect_cv_event_outbox"();

COMMENT ON TABLE "profile"."cv_event_outbox" IS
  'Independent immutable cv-events intents; no CV/Profile FK by design';

COMMIT;
