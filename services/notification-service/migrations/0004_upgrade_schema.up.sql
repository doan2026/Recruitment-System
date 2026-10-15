-- Add source tracking and payload columns to notifications
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS source_topic VARCHAR(100),
    ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Backfill read_at from is_read
UPDATE notifications SET read_at = created_at WHERE is_read = TRUE AND read_at IS NULL;

-- Unique constraint for idempotent event projection per recipient
CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_recipient_key
    ON notifications (source_topic, source_event_id, user_id)
    WHERE source_topic IS NOT NULL;

-- Upgrade processed_events with hash-based collision detection
ALTER TABLE processed_events
    ADD COLUMN IF NOT EXISTS topic VARCHAR(100),
    ADD COLUMN IF NOT EXISTS event_key VARCHAR(128),
    ADD COLUMN IF NOT EXISTS payload_sha256 CHAR(64),
    ADD COLUMN IF NOT EXISTS schema_version INT;

-- Create poison_events table for quarantined messages
CREATE TABLE IF NOT EXISTS poison_events (
    id BIGSERIAL PRIMARY KEY,
    topic VARCHAR(100) NOT NULL,
    partition INT NOT NULL,
    "offset" BIGINT NOT NULL,
    event_key_sha256 CHAR(64) NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    error_code VARCHAR(80) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(topic, partition, "offset")
);

-- Create notification_logs for delivery tracking
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
    channel VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempt INT DEFAULT 0,
    error_code VARCHAR(100),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(notification_id, channel)
);

CREATE INDEX IF NOT EXISTS notification_logs_status_created_idx
    ON notification_logs(status, created_at);

-- Create notification_settings for user preferences
CREATE TABLE IF NOT EXISTS notification_settings (
    user_id UUID PRIMARY KEY,
    email_enabled BOOLEAN DEFAULT TRUE,
    push_enabled BOOLEAN DEFAULT TRUE,
    version INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
