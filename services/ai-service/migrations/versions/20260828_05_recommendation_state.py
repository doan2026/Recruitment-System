"""Add transactional recommendation generations.

Revision ID: 20260828_05
Revises: 20260828_04
Create Date: 2026-08-28
"""

from __future__ import annotations

from alembic import op

revision = "20260828_05"
down_revision = "20260828_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE ai.recommendation_generations (
            target_type VARCHAR(16) PRIMARY KEY,
            generation BIGINT NOT NULL,
            CONSTRAINT recommendation_generations_type_check
                CHECK (target_type IN ('JOBS', 'CVS')),
            CONSTRAINT recommendation_generations_value_check
                CHECK (generation > 0)
        )
        """
    )
    op.execute(
        """
        INSERT INTO ai.recommendation_generations (target_type, generation)
        VALUES ('JOBS', 1), ('CVS', 1)
        """
    )
    op.execute(
        """
        CREATE FUNCTION ai.bump_recommendation_generation()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
            UPDATE ai.recommendation_generations
            SET generation = generation + 1
            WHERE target_type = TG_ARGV[0];
            IF NOT FOUND THEN
                RAISE EXCEPTION
                    'recommendation generation target is not configured';
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER job_embeddings_recommendation_generation
        AFTER INSERT OR UPDATE OR DELETE
        ON ai.job_embeddings
        FOR EACH ROW
        EXECUTE FUNCTION ai.bump_recommendation_generation('JOBS')
        """
    )
    op.execute(
        """
        CREATE TRIGGER job_embeddings_recommendation_truncate
        AFTER TRUNCATE
        ON ai.job_embeddings
        FOR EACH STATEMENT
        EXECUTE FUNCTION ai.bump_recommendation_generation('JOBS')
        """
    )
    op.execute(
        """
        CREATE TRIGGER cv_embeddings_recommendation_generation
        AFTER INSERT OR UPDATE OR DELETE
        ON ai.cv_embeddings
        FOR EACH ROW
        EXECUTE FUNCTION ai.bump_recommendation_generation('CVS')
        """
    )
    op.execute(
        """
        CREATE TRIGGER cv_embeddings_recommendation_truncate
        AFTER TRUNCATE
        ON ai.cv_embeddings
        FOR EACH STATEMENT
        EXECUTE FUNCTION ai.bump_recommendation_generation('CVS')
        """
    )
    op.execute(
        """
        COMMENT ON TABLE ai.recommendation_generations IS
        'Transactional target-set generations for stale cursor detection'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER IF EXISTS
            cv_embeddings_recommendation_truncate
        ON ai.cv_embeddings
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS
            job_embeddings_recommendation_truncate
        ON ai.job_embeddings
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS
            cv_embeddings_recommendation_generation
        ON ai.cv_embeddings
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS
            job_embeddings_recommendation_generation
        ON ai.job_embeddings
        """
    )
    op.execute("DROP FUNCTION IF EXISTS ai.bump_recommendation_generation()")
    op.execute("DROP TABLE IF EXISTS ai.recommendation_generations")
