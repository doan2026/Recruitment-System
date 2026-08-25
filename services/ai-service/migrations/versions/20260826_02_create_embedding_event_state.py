"""Create durable state for idempotent embedding-event ingestion.

Revision ID: 20260826_02
Revises: 20260825_01
Create Date: 2026-08-26
"""

from __future__ import annotations

from alembic import op

revision = "20260826_02"
down_revision = "20260825_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai.cv_embeddings
            ADD COLUMN source_event_id UUID,
            ADD COLUMN source_version BIGINT,
            ADD COLUMN source_occurred_at TIMESTAMPTZ,
            ADD CONSTRAINT cv_embeddings_source_version_check
                CHECK (source_version IS NULL OR source_version >= 0)
        """
    )
    op.execute(
        """
        ALTER TABLE ai.job_embeddings
            ADD COLUMN source_event_id UUID,
            ADD COLUMN source_version BIGINT,
            ADD COLUMN source_occurred_at TIMESTAMPTZ,
            ADD CONSTRAINT job_embeddings_source_version_check
                CHECK (source_version IS NULL OR source_version >= 0)
        """
    )
    op.execute(
        """
        CREATE TABLE ai.embedding_aggregate_cursors (
            aggregate_type VARCHAR(16) NOT NULL,
            aggregate_id UUID NOT NULL,
            last_event_id UUID NOT NULL,
            last_aggregate_version BIGINT,
            last_occurred_at TIMESTAMPTZ NOT NULL,
            last_state_hash CHAR(64) NOT NULL,
            last_topic VARCHAR(100) NOT NULL,
            last_kafka_partition INTEGER NOT NULL,
            last_kafka_offset BIGINT NOT NULL,
            last_action VARCHAR(32) NOT NULL,
            tombstoned BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT embedding_aggregate_cursors_pkey
                PRIMARY KEY (aggregate_type, aggregate_id),
            CONSTRAINT embedding_aggregate_cursors_type_check
                CHECK (aggregate_type IN ('CV', 'JOB')),
            CONSTRAINT embedding_aggregate_cursors_version_check
                CHECK (
                    last_aggregate_version IS NULL
                    OR last_aggregate_version >= 0
                ),
            CONSTRAINT embedding_aggregate_cursors_state_hash_check
                CHECK (last_state_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT embedding_aggregate_cursors_topic_check
                CHECK (length(trim(last_topic)) > 0),
            CONSTRAINT embedding_aggregate_cursors_partition_check
                CHECK (last_kafka_partition >= 0),
            CONSTRAINT embedding_aggregate_cursors_offset_check
                CHECK (last_kafka_offset >= 0),
            CONSTRAINT embedding_aggregate_cursors_action_check
                CHECK (length(trim(last_action)) > 0)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE ai.embedding_event_ledger (
            event_id UUID PRIMARY KEY,
            topic VARCHAR(100) NOT NULL,
            kafka_partition INTEGER NOT NULL,
            kafka_offset BIGINT NOT NULL,
            aggregate_type VARCHAR(16) NOT NULL,
            aggregate_id UUID NOT NULL,
            action VARCHAR(32) NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            aggregate_version BIGINT,
            occurred_at TIMESTAMPTZ NOT NULL,
            payload_hash CHAR(64) NOT NULL,
            state_hash CHAR(64) NOT NULL,
            text_hash CHAR(64),
            outcome VARCHAR(32) NOT NULL,
            processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT embedding_event_ledger_transport_unique
                UNIQUE (topic, kafka_partition, kafka_offset),
            CONSTRAINT embedding_event_ledger_topic_check
                CHECK (length(trim(topic)) > 0),
            CONSTRAINT embedding_event_ledger_partition_check
                CHECK (kafka_partition >= 0),
            CONSTRAINT embedding_event_ledger_offset_check
                CHECK (kafka_offset >= 0),
            CONSTRAINT embedding_event_ledger_type_check
                CHECK (aggregate_type IN ('CV', 'JOB')),
            CONSTRAINT embedding_event_ledger_action_check
                CHECK (length(trim(action)) > 0),
            CONSTRAINT embedding_event_ledger_schema_version_check
                CHECK (schema_version > 0),
            CONSTRAINT embedding_event_ledger_aggregate_version_check
                CHECK (aggregate_version IS NULL OR aggregate_version >= 0),
            CONSTRAINT embedding_event_ledger_payload_hash_check
                CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT embedding_event_ledger_state_hash_check
                CHECK (state_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT embedding_event_ledger_text_hash_check
                CHECK (text_hash IS NULL OR text_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT embedding_event_ledger_outcome_check
                CHECK (
                    outcome IN (
                        'APPLIED',
                        'SKIPPED_STALE',
                        'SKIPPED_UNCHANGED',
                        'DEAD_LETTER'
                    )
                )
        )
        """
    )
    op.execute(
        """
        CREATE INDEX embedding_event_ledger_aggregate_idx
        ON ai.embedding_event_ledger (
            aggregate_type,
            aggregate_id,
            occurred_at DESC
        )
        """
    )
    op.execute(
        """
        CREATE INDEX embedding_event_ledger_processed_idx
        ON ai.embedding_event_ledger (processed_at)
        """
    )
    op.execute(
        """
        CREATE TABLE ai.embedding_dead_letters (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            event_id UUID,
            topic VARCHAR(100) NOT NULL,
            kafka_partition INTEGER NOT NULL,
            kafka_offset BIGINT NOT NULL,
            key_hash CHAR(64),
            aggregate_type VARCHAR(16),
            aggregate_id UUID,
            action VARCHAR(32),
            payload_hash CHAR(64) NOT NULL,
            error_code VARCHAR(64) NOT NULL,
            error_message VARCHAR(500) NOT NULL,
            attempt_count INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT embedding_dead_letters_transport_unique
                UNIQUE (topic, kafka_partition, kafka_offset),
            CONSTRAINT embedding_dead_letters_topic_check
                CHECK (length(trim(topic)) > 0),
            CONSTRAINT embedding_dead_letters_partition_check
                CHECK (kafka_partition >= 0),
            CONSTRAINT embedding_dead_letters_offset_check
                CHECK (kafka_offset >= 0),
            CONSTRAINT embedding_dead_letters_type_check
                CHECK (aggregate_type IS NULL OR aggregate_type IN ('CV', 'JOB')),
            CONSTRAINT embedding_dead_letters_action_check
                CHECK (action IS NULL OR length(trim(action)) > 0),
            CONSTRAINT embedding_dead_letters_identity_check
                CHECK (
                    (event_id IS NULL AND aggregate_type IS NULL
                        AND aggregate_id IS NULL AND action IS NULL)
                    OR
                    (event_id IS NOT NULL AND aggregate_type IS NOT NULL
                        AND aggregate_id IS NOT NULL AND action IS NOT NULL)
                ),
            CONSTRAINT embedding_dead_letters_key_hash_check
                CHECK (key_hash IS NULL OR key_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT embedding_dead_letters_payload_hash_check
                CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT embedding_dead_letters_error_code_check
                CHECK (error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
            CONSTRAINT embedding_dead_letters_error_message_check
                CHECK (length(trim(error_message)) > 0),
            CONSTRAINT embedding_dead_letters_attempt_count_check
                CHECK (attempt_count > 0)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX embedding_dead_letters_created_idx
        ON ai.embedding_dead_letters (created_at)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE ai.embedding_event_ledger IS
        'Terminal idempotency ledger; raw Kafka payloads are never stored'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE ai.embedding_dead_letters IS
        'Sanitized poison-event metadata only; raw source content is forbidden'
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai.embedding_dead_letters")
    op.execute("DROP TABLE IF EXISTS ai.embedding_event_ledger")
    op.execute("DROP TABLE IF EXISTS ai.embedding_aggregate_cursors")
    op.execute(
        """
        ALTER TABLE ai.job_embeddings
            DROP CONSTRAINT IF EXISTS job_embeddings_source_version_check,
            DROP COLUMN IF EXISTS source_occurred_at,
            DROP COLUMN IF EXISTS source_version,
            DROP COLUMN IF EXISTS source_event_id
        """
    )
    op.execute(
        """
        ALTER TABLE ai.cv_embeddings
            DROP CONSTRAINT IF EXISTS cv_embeddings_source_version_check,
            DROP COLUMN IF EXISTS source_occurred_at,
            DROP COLUMN IF EXISTS source_version,
            DROP COLUMN IF EXISTS source_event_id
        """
    )
