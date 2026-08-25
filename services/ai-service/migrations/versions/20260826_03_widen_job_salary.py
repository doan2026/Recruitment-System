"""Widen Job embedding salary columns to match the Job source of truth.

Revision ID: 20260826_03
Revises: 20260826_02
Create Date: 2026-08-26
"""

from __future__ import annotations

from alembic import op

revision = "20260826_03"
down_revision = "20260826_02"
branch_labels = None
depends_on = None

_OLD_MAX_MONEY = "999999999999.99"


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai.job_embeddings
            ALTER COLUMN salary_min TYPE NUMERIC(15, 2),
            ALTER COLUMN salary_max TYPE NUMERIC(15, 2)
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM ai.job_embeddings
                WHERE salary_min > {_OLD_MAX_MONEY}
                   OR salary_max > {_OLD_MAX_MONEY}
            ) THEN
                RAISE EXCEPTION
                    'Cannot narrow Job embedding salary to NUMERIC(14,2)';
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        ALTER TABLE ai.job_embeddings
            ALTER COLUMN salary_min TYPE NUMERIC(14, 2),
            ALTER COLUMN salary_max TYPE NUMERIC(14, 2)
        """
    )
