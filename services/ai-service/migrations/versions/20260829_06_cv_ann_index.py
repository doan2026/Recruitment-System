"""Add the active CV HNSW cosine index.

Revision ID: 20260829_06
Revises: 20260828_05
Create Date: 2026-08-29
"""

from __future__ import annotations

from alembic import op

revision = "20260829_06"
down_revision = "20260828_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A failed concurrent build can leave an invalid relation behind while the
    # Alembic revision is still unrecorded. Dropping by the dedicated name first
    # makes a retry deterministic without blocking CV ingestion for the full
    # HNSW build.
    with op.get_context().autocommit_block():
        op.execute(
            """
            DROP INDEX CONCURRENTLY IF EXISTS
                ai.cv_embeddings_active_vector_hnsw_idx
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY cv_embeddings_active_vector_hnsw_idx
            ON ai.cv_embeddings
            USING hnsw (vector vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
            WHERE is_active
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            """
            DROP INDEX CONCURRENTLY IF EXISTS
                ai.cv_embeddings_active_vector_hnsw_idx
            """
        )
