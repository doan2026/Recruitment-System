CREATE TYPE "notification"."NotificationType" AS ENUM (
    'APPLICATION_RECEIVED',
    'APPLICATION_STATUS_CHANGED',
    'OFFER_RECEIVED',
    'OFFER_ACCEPTED',
    'OFFER_DECLINED'
);

CREATE TYPE "notification"."DeliveryChannel" AS ENUM (
    'IN_APP',
    'PUSH',
    'EMAIL'
);

CREATE TYPE "notification"."DeliveryStatus" AS ENUM (
    'PENDING',
    'SENT',
    'FAILED'
);

CREATE TYPE "notification"."DevicePlatform" AS ENUM (
    'WEB',
    'ANDROID',
    'IOS'
);

CREATE TABLE "notification"."notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "notification"."NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "source_topic" VARCHAR(100) NOT NULL,
    "source_event_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_payload_object_check"
        CHECK (jsonb_typeof("payload_json") = 'object')
);

CREATE TABLE "notification"."processed_events" (
    "id" BIGSERIAL NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "event_id" UUID NOT NULL,
    "event_key" UUID NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "schema_version" INTEGER,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "processed_events_schema_version_check"
        CHECK ("schema_version" IS NULL OR "schema_version" = 1),
    CONSTRAINT "processed_events_payload_hash_check"
        CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "notification"."poison_events" (
    "id" BIGSERIAL NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" BIGINT NOT NULL,
    "event_key_sha256" CHAR(64) NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "error_code" VARCHAR(80) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poison_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "poison_events_partition_offset_check"
        CHECK ("partition" >= 0 AND "offset" >= 0),
    CONSTRAINT "poison_events_hash_check"
        CHECK (
            "event_key_sha256" ~ '^[0-9a-f]{64}$' AND
            "payload_sha256" ~ '^[0-9a-f]{64}$'
        )
);

CREATE TABLE "notification"."device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_ciphertext" TEXT NOT NULL,
    "platform" "notification"."DevicePlatform" NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_tokens_hash_check"
        CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "notification"."notification_logs" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "notification"."DeliveryChannel" NOT NULL,
    "status" "notification"."DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(100),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_logs_attempt_check" CHECK ("attempt" >= 0)
);

CREATE TABLE "notification"."notification_settings" (
    "user_id" UUID NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "notification_settings_version_check" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "notifications_source_recipient_key"
    ON "notification"."notifications"("source_topic", "source_event_id", "user_id");
CREATE INDEX "notifications_user_cursor_idx"
    ON "notification"."notifications"("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "notifications_user_unread_idx"
    ON "notification"."notifications"("user_id", "created_at" DESC, "id" DESC)
    WHERE "read_at" IS NULL;
CREATE UNIQUE INDEX "processed_events_topic_event_key"
    ON "notification"."processed_events"("topic", "event_id");
CREATE UNIQUE INDEX "poison_events_topic_partition_offset_key"
    ON "notification"."poison_events"("topic", "partition", "offset");
CREATE UNIQUE INDEX "device_tokens_token_hash_key"
    ON "notification"."device_tokens"("token_hash");
CREATE INDEX "device_tokens_user_idx"
    ON "notification"."device_tokens"("user_id");
CREATE UNIQUE INDEX "notification_logs_notification_channel_key"
    ON "notification"."notification_logs"("notification_id", "channel");
CREATE INDEX "notification_logs_status_created_idx"
    ON "notification"."notification_logs"("status", "created_at");

ALTER TABLE "notification"."notification_logs"
    ADD CONSTRAINT "notification_logs_notification_id_fkey"
    FOREIGN KEY ("notification_id")
    REFERENCES "notification"."notifications"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
