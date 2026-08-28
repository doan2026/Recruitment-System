"""Add CV ingestion lifecycle state.

Revision ID: 20260828_04
Revises: 20260826_03
Create Date: 2026-08-28
"""

from __future__ import annotations

from alembic import op

revision = "20260828_04"
down_revision = "20260826_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE ai.cv_aggregate_owners (
            cv_id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        INSERT INTO ai.cv_aggregate_owners (cv_id, user_id)
        SELECT cv_id, user_id
        FROM ai.cv_embeddings
        ON CONFLICT (cv_id) DO NOTHING
        """
    )
    op.execute(
        """
        COMMENT ON TABLE ai.cv_aggregate_owners IS
            'Durable immutable CV-to-user ownership; retained after tombstones'
        """
    )
    op.execute(
        """
        CREATE FUNCTION ai.reject_cv_aggregate_owner_mutation()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'cv_aggregate_owners rows are immutable';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER cv_aggregate_owners_immutable
        BEFORE UPDATE OR DELETE ON ai.cv_aggregate_owners
        FOR EACH ROW
        EXECUTE FUNCTION ai.reject_cv_aggregate_owner_mutation()
        """
    )
    op.execute(
        """
        ALTER TABLE ai.cv_embeddings
            ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE
        """
    )
    op.execute(
        """
        CREATE INDEX cv_embeddings_active_user_idx
        ON ai.cv_embeddings (user_id, updated_at DESC, cv_id)
        WHERE is_active
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ai.cv_embeddings_active_user_idx")
    op.execute("ALTER TABLE ai.cv_embeddings DROP COLUMN IF EXISTS is_active")
    op.execute(
        "DROP TRIGGER IF EXISTS cv_aggregate_owners_immutable "
        "ON ai.cv_aggregate_owners"
    )
    op.execute("DROP TABLE IF EXISTS ai.cv_aggregate_owners")
    op.execute("DROP FUNCTION IF EXISTS ai.reject_cv_aggregate_owner_mutation()")
