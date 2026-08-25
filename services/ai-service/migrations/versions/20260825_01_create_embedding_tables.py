"""Create pgvector-backed CV and job embedding tables.

Revision ID: 20260825_01
Revises:
Create Date: 2026-08-25
"""

from __future__ import annotations

from alembic import op

revision = "20260825_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS ai")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public")
    op.execute(
        """
        CREATE TABLE ai.cv_embeddings (
            cv_id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            vector vector(384) NOT NULL,
            text_hash CHAR(64) NOT NULL,
            model_name VARCHAR(128) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT cv_embeddings_text_hash_check
                CHECK (text_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT cv_embeddings_model_name_check
                CHECK (length(trim(model_name)) > 0)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE ai.job_embeddings (
            job_id UUID PRIMARY KEY,
            vector vector(384) NOT NULL,
            text_hash CHAR(64) NOT NULL,
            model_name VARCHAR(128) NOT NULL,
            location VARCHAR(255),
            salary_min NUMERIC(14, 2),
            salary_max NUMERIC(14, 2),
            job_type VARCHAR(50),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT job_embeddings_text_hash_check
                CHECK (text_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT job_embeddings_model_name_check
                CHECK (length(trim(model_name)) > 0),
            CONSTRAINT job_embeddings_salary_min_check
                CHECK (salary_min IS NULL OR salary_min >= 0),
            CONSTRAINT job_embeddings_salary_max_check
                CHECK (salary_max IS NULL OR salary_max >= 0),
            CONSTRAINT job_embeddings_salary_range_check
                CHECK (
                    salary_min IS NULL
                    OR salary_max IS NULL
                    OR salary_max >= salary_min
                )
        )
        """
    )
    op.execute(
        """
        CREATE INDEX job_embeddings_active_vector_hnsw_idx
        ON ai.job_embeddings
        USING hnsw (vector vector_cosine_ops)
        WHERE is_active
        """
    )
    op.execute(
        """
        COMMENT ON TABLE ai.cv_embeddings IS
        'CV vectors only; original CV content must not be stored here'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE ai.job_embeddings IS
        'Job vectors and minimal filtering metadata only'
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai.job_embeddings")
    op.execute("DROP TABLE IF EXISTS ai.cv_embeddings")
