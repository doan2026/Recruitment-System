DROP TABLE IF EXISTS notification_settings;
DROP TABLE IF EXISTS notification_logs;
DROP TABLE IF EXISTS poison_events;

ALTER TABLE processed_events
    DROP COLUMN IF EXISTS topic,
    DROP COLUMN IF EXISTS event_key,
    DROP COLUMN IF EXISTS payload_sha256,
    DROP COLUMN IF EXISTS schema_version;

ALTER TABLE notifications
    DROP COLUMN IF EXISTS source_topic,
    DROP COLUMN IF EXISTS source_event_id,
    DROP COLUMN IF EXISTS read_at;
