ALTER TABLE "job"."jobs"
    ADD COLUMN "aggregate_version" INTEGER NOT NULL DEFAULT 1,
    ADD CONSTRAINT "jobs_aggregate_version_check"
      CHECK ("aggregate_version" > 0);

CREATE TYPE "job"."JobEventAction" AS ENUM (
    'CREATED', 'UPDATED', 'CLOSED', 'EXPIRED'
);

CREATE TABLE "job"."job_event_outbox" (
    "event_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "action" "job"."JobEventAction" NOT NULL,
    "topic" VARCHAR(100) NOT NULL DEFAULT 'job-events',
    "event_key" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" VARCHAR(200),
    "lease_expires_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_event_outbox_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "job_event_outbox_job_id_fkey"
      FOREIGN KEY ("job_id") REFERENCES "job"."jobs"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "job_event_outbox_job_id_aggregate_version_key"
      UNIQUE ("job_id", "aggregate_version"),
    CONSTRAINT "job_event_outbox_aggregate_version_check"
      CHECK ("aggregate_version" > 0),
    CONSTRAINT "job_event_outbox_attempts_check"
      CHECK ("attempts" >= 0),
    CONSTRAINT "job_event_outbox_event_key_check"
      CHECK ("event_key" = "job_id"),
    CONSTRAINT "job_event_outbox_topic_check"
      CHECK (length(trim("topic")) > 0),
    CONSTRAINT "job_event_outbox_lease_check"
      CHECK (("lease_owner" IS NULL) = ("lease_expires_at" IS NULL)),
    CONSTRAINT "job_event_outbox_published_lease_check"
      CHECK (
        "published_at" IS NULL
        OR ("lease_owner" IS NULL AND "lease_expires_at" IS NULL)
      ),
    CONSTRAINT "job_event_outbox_payload_shape_check"
      CHECK (
        jsonb_typeof("payload") = 'object'
        AND "payload" ?& ARRAY[
          'event_id',
          'action',
          'job_id',
          'company_id',
          'title',
          'description',
          'skills',
          'location',
          'status',
          'occurred_at',
          'schema_version',
          'aggregate_version',
          'requirements',
          'salary_min',
          'salary_max',
          'job_type'
        ]
        AND (
          "payload" - ARRAY[
            'event_id',
            'action',
            'job_id',
            'company_id',
            'title',
            'description',
            'skills',
            'location',
            'status',
            'occurred_at',
            'schema_version',
            'aggregate_version',
            'requirements',
            'salary_min',
            'salary_max',
            'job_type'
          ]
        ) = '{}'::jsonb
        AND jsonb_typeof("payload"->'event_id') = 'string'
        AND jsonb_typeof("payload"->'action') = 'string'
        AND jsonb_typeof("payload"->'job_id') = 'string'
        AND jsonb_typeof("payload"->'company_id') = 'string'
        AND jsonb_typeof("payload"->'title') = 'string'
        AND jsonb_typeof("payload"->'description') = 'string'
        AND jsonb_typeof("payload"->'skills') = 'array'
        AND jsonb_typeof("payload"->'location') = 'string'
        AND jsonb_typeof("payload"->'status') = 'string'
        AND jsonb_typeof("payload"->'occurred_at') = 'string'
        AND "payload"->'schema_version' = '1'::jsonb
        AND jsonb_typeof("payload"->'aggregate_version') = 'number'
        AND jsonb_typeof("payload"->'requirements') = 'string'
        AND jsonb_typeof("payload"->'salary_min') IN ('string', 'null')
        AND jsonb_typeof("payload"->'salary_max') IN ('string', 'null')
        AND jsonb_typeof("payload"->'job_type') = 'string'
        AND "payload"->>'event_id' = "event_id"::text
        AND "payload"->>'action' = "action"::text
        AND "payload"->>'job_id' = "job_id"::text
        AND "payload"->>'aggregate_version' = "aggregate_version"::text
        AND (
          ("payload"->>'action' = 'CREATED'
            AND "payload"->>'status' = 'DRAFT')
          OR ("payload"->>'action' = 'UPDATED'
            AND "payload"->>'status' IN (
              'DRAFT', 'PENDING_APPROVAL', 'PUBLISHED'
            ))
          OR ("payload"->>'action' = 'CLOSED'
            AND "payload"->>'status' = 'CLOSED')
          OR ("payload"->>'action' = 'EXPIRED'
            AND "payload"->>'status' = 'EXPIRED')
        )
      )
);

CREATE INDEX "job_event_outbox_pending_idx"
    ON "job"."job_event_outbox"("next_attempt_at", "created_at")
    WHERE "published_at" IS NULL;

CREATE INDEX "job_event_outbox_lease_expires_at_idx"
    ON "job"."job_event_outbox"("lease_expires_at");

CREATE INDEX "job_event_outbox_published_at_idx"
    ON "job"."job_event_outbox"("published_at")
    WHERE "published_at" IS NOT NULL;

CREATE FUNCTION "job"."protect_job_event_outbox_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
      NEW."event_id",
      NEW."job_id",
      NEW."aggregate_version",
      NEW."action",
      NEW."topic",
      NEW."event_key",
      NEW."payload",
      NEW."created_at"
    ) IS DISTINCT FROM ROW(
      OLD."event_id",
      OLD."job_id",
      OLD."aggregate_version",
      OLD."action",
      OLD."topic",
      OLD."event_key",
      OLD."payload",
      OLD."created_at"
    ) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'check_violation',
          MESSAGE = 'Job event outbox identity and payload are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "job_event_outbox_identity_immutable"
BEFORE UPDATE ON "job"."job_event_outbox"
FOR EACH ROW
EXECUTE FUNCTION "job"."protect_job_event_outbox_identity"();
