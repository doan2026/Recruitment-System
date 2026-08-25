"""PostgreSQL/pgvector access for match scoring."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import psycopg

logger = logging.getLogger(__name__)


class MatchStoreUnavailable(RuntimeError):
    """Raised when a match result cannot safely be read from the vector store."""


@dataclass(frozen=True, slots=True)
class MatchResult:
    score: float | None
    reason: str | None


class MatchRepository(Protocol):
    def calculate(self, cv_id: UUID, job_id: UUID) -> MatchResult: ...


class ReadinessProbe(Protocol):
    def check(self) -> None: ...


class PsycopgMatchRepository:
    _MATCH_QUERY = """
        WITH cv AS (
            SELECT vector, model_name
            FROM ai.cv_embeddings
            WHERE cv_id = %s
        ),
        job AS (
            SELECT vector, model_name
            FROM ai.job_embeddings
            WHERE job_id = %s
        )
        SELECT
            EXISTS (SELECT 1 FROM cv) AS cv_exists,
            EXISTS (SELECT 1 FROM job) AS job_exists,
            (SELECT model_name FROM cv) AS cv_model_name,
            (SELECT model_name FROM job) AS job_model_name,
            (
                SELECT 1.0 - ((cv.vector <=> job.vector) / 2.0)
                FROM cv CROSS JOIN job
            ) AS score
    """

    def __init__(
        self,
        database_url: str,
        *,
        connect_timeout_seconds: int,
        statement_timeout_ms: int,
    ) -> None:
        self._database_url = database_url
        self._connect_timeout_seconds = connect_timeout_seconds
        self._statement_timeout_ms = statement_timeout_ms

    def calculate(self, cv_id: UUID, job_id: UUID) -> MatchResult:
        try:
            with psycopg.connect(
                self._database_url,
                connect_timeout=self._connect_timeout_seconds,
            ) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT set_config('statement_timeout', %s, true)",
                        (str(self._statement_timeout_ms),),
                    )
                    cursor.execute(self._MATCH_QUERY, (cv_id, job_id))
                    row = cursor.fetchone()
        except psycopg.Error as error:
            logger.warning(
                "AI match vector query failed (%s)",
                type(error).__name__,
            )
            raise MatchStoreUnavailable from error

        if row is None:
            raise MatchStoreUnavailable

        cv_exists, job_exists, cv_model_name, job_model_name, raw_score = row
        if not cv_exists and not job_exists:
            return MatchResult(
                score=None,
                reason="CV_AND_JOB_EMBEDDINGS_NOT_FOUND",
            )
        if not cv_exists:
            return MatchResult(score=None, reason="CV_EMBEDDING_NOT_FOUND")
        if not job_exists:
            return MatchResult(score=None, reason="JOB_EMBEDDING_NOT_FOUND")
        if cv_model_name != job_model_name:
            return MatchResult(score=None, reason="EMBEDDING_MODEL_MISMATCH")
        if raw_score is None:
            raise MatchStoreUnavailable

        score = float(raw_score)
        if not math.isfinite(score) or score < 0.0 or score > 1.0:
            raise MatchStoreUnavailable
        return MatchResult(score=score, reason=None)

    def check(self) -> None:
        try:
            with psycopg.connect(
                self._database_url,
                connect_timeout=self._connect_timeout_seconds,
            ) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT set_config('statement_timeout', %s, true)",
                        (str(self._statement_timeout_ms),),
                    )
                    cursor.execute(
                        """
                        SELECT
                            EXISTS (
                                SELECT 1 FROM pg_extension
                                WHERE extname = 'vector'
                            ),
                            to_regclass('ai.cv_embeddings') IS NOT NULL,
                            to_regclass('ai.job_embeddings') IS NOT NULL
                        """
                    )
                    row = cursor.fetchone()
        except psycopg.Error as error:
            logger.warning(
                "AI vector store readiness check failed (%s)",
                type(error).__name__,
            )
            raise MatchStoreUnavailable from error

        if row != (True, True, True):
            raise MatchStoreUnavailable
