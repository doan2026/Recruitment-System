"""Read-only PostgreSQL/pgvector queries for recommendation v1."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg import Cursor

from app.recommendation import (
    CANDIDATE_RECOMMENDATION_MAXIMUM_SCOPE,
    RECOMMENDATION_MAXIMUM_PAGES,
    CandidateRecommendationFilters,
    CandidateRecommendationReason,
    JobRecommendationFilters,
    JobRecommendationReason,
    RecommendationBoundary,
    RecommendationDistanceItem,
    RecommendationPage,
    RecommendationReason,
    RecommendationStoreUnavailable,
    StaleRecommendationCursor,
)

logger = logging.getLogger(__name__)
_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class PsycopgRecommendationRepository:
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

    def recommend_jobs(
        self,
        cv_id: UUID,
        filters: JobRecommendationFilters,
        *,
        limit: int,
        boundary: RecommendationBoundary | None,
        expected_source_fingerprint: str | None,
    ) -> RecommendationPage:
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._start_snapshot(cursor)
                    source = cursor.execute(
                        """
                        SELECT
                            is_active,
                            model_name,
                            text_hash,
                            source_version,
                            updated_at,
                            vector::text
                        FROM ai.cv_embeddings
                        WHERE cv_id = %s
                        """,
                        (cv_id,),
                    ).fetchone()
                    if source is None:
                        return _source_empty_or_stale(
                            expected_source_fingerprint,
                            JobRecommendationReason.CV_EMBEDDING_NOT_FOUND,
                        )
                    (
                        is_active,
                        model_name,
                        text_hash,
                        source_version,
                        source_updated_at,
                        source_vector,
                    ) = source
                    if not isinstance(is_active, bool):
                        raise RecommendationStoreUnavailable
                    if not is_active:
                        return _source_empty_or_stale(
                            expected_source_fingerprint,
                            JobRecommendationReason.CV_EMBEDDING_INACTIVE,
                        )

                    target_stats = cursor.execute(
                        """
                        SELECT
                            count(*) FILTER (WHERE is_active),
                            count(*) FILTER (
                                WHERE is_active AND model_name = %s
                            ),
                            (
                                SELECT generation
                                FROM ai.recommendation_generations
                                WHERE target_type = 'JOBS'
                            )
                        FROM ai.job_embeddings
                        """,
                        (model_name,),
                    ).fetchone()
                    if target_stats is None:
                        raise RecommendationStoreUnavailable
                    (
                        active_count,
                        compatible_count,
                        target_generation,
                    ) = target_stats
                    _validate_target_counts(active_count, compatible_count)
                    source_fingerprint = _source_fingerprint(
                        kind="jobs",
                        source_id=cv_id,
                        model_name=model_name,
                        text_hash=text_hash,
                        source_version=source_version,
                        source_updated_at=source_updated_at,
                        source_vector=source_vector,
                        target_generation=target_generation,
                    )
                    _require_current_snapshot(
                        expected_source_fingerprint,
                        source_fingerprint,
                    )
                    if active_count == 0:
                        return _empty_page(
                            JobRecommendationReason.NO_ACTIVE_JOB_EMBEDDINGS,
                            source_fingerprint,
                        )
                    if compatible_count == 0:
                        return _empty_page(
                            JobRecommendationReason.EMBEDDING_MODEL_MISMATCH,
                            source_fingerprint,
                        )

                    self._force_exact_vector_plan(cursor)
                    rows = self._job_rows(
                        cursor,
                        source_vector=source_vector,
                        model_name=model_name,
                        filters=filters,
                        limit=limit,
                        boundary=boundary,
                    )
        except psycopg.Error as error:
            logger.warning(
                "AI job recommendation query failed (%s)",
                type(error).__name__,
            )
            raise RecommendationStoreUnavailable from error

        return _page_from_rows(
            rows,
            limit=limit,
            source_fingerprint=source_fingerprint,
            boundary=boundary,
            empty_reason=JobRecommendationReason.NO_MATCHING_JOB_EMBEDDINGS,
        )

    def recommend_candidates(
        self,
        job_id: UUID,
        filters: CandidateRecommendationFilters,
        *,
        job_version: int,
        limit: int,
        boundary: RecommendationBoundary | None,
        expected_source_fingerprint: str | None,
    ) -> RecommendationPage:
        eligible_candidate_ids, eligible_cv_ids = _candidate_scope_arrays(filters)
        _validate_job_version(job_version)
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._start_snapshot(cursor)
                    source = cursor.execute(
                        """
                        SELECT
                            is_active,
                            model_name,
                            text_hash,
                            source_version,
                            updated_at,
                            vector::text
                        FROM ai.job_embeddings
                        WHERE job_id = %s
                        """,
                        (job_id,),
                    ).fetchone()
                    if source is None:
                        return _source_empty_or_stale(
                            expected_source_fingerprint,
                            CandidateRecommendationReason.JOB_EMBEDDING_NOT_FOUND,
                        )
                    (
                        is_active,
                        model_name,
                        text_hash,
                        source_version,
                        source_updated_at,
                        source_vector,
                    ) = source
                    if not isinstance(is_active, bool):
                        raise RecommendationStoreUnavailable
                    _require_exact_source_version(source_version, job_version)
                    if not is_active:
                        return _source_empty_or_stale(
                            expected_source_fingerprint,
                            CandidateRecommendationReason.JOB_EMBEDDING_INACTIVE,
                        )

                    target_stats = cursor.execute(
                        """
                        WITH eligible_scope(candidate_id, cv_id) AS (
                            SELECT *
                            FROM unnest(%s::uuid[], %s::uuid[])
                        )
                        SELECT
                            count(*) FILTER (WHERE c.is_active),
                            count(*) FILTER (
                                WHERE c.is_active AND c.model_name = %s
                            ),
                            (
                                SELECT generation
                                FROM ai.recommendation_generations
                                WHERE target_type = 'CVS'
                            )
                        FROM eligible_scope AS eligible
                        JOIN ai.cv_embeddings AS c
                          ON c.user_id = eligible.candidate_id
                         AND c.cv_id = eligible.cv_id
                        """,
                        (eligible_candidate_ids, eligible_cv_ids, model_name),
                    ).fetchone()
                    if target_stats is None:
                        raise RecommendationStoreUnavailable
                    (
                        active_count,
                        compatible_count,
                        target_generation,
                    ) = target_stats
                    _validate_target_counts(active_count, compatible_count)
                    source_fingerprint = _source_fingerprint(
                        kind="candidates",
                        source_id=job_id,
                        model_name=model_name,
                        text_hash=text_hash,
                        source_version=source_version,
                        source_updated_at=source_updated_at,
                        source_vector=source_vector,
                        target_generation=target_generation,
                    )
                    _require_current_snapshot(
                        expected_source_fingerprint,
                        source_fingerprint,
                    )
                    if active_count == 0:
                        return _empty_page(
                            CandidateRecommendationReason.NO_ACTIVE_CV_EMBEDDINGS,
                            source_fingerprint,
                        )
                    if compatible_count == 0:
                        return _empty_page(
                            CandidateRecommendationReason.EMBEDDING_MODEL_MISMATCH,
                            source_fingerprint,
                        )

                    rows = self._candidate_rows(
                        cursor,
                        source_vector=source_vector,
                        model_name=model_name,
                        eligible_candidate_ids=eligible_candidate_ids,
                        eligible_cv_ids=eligible_cv_ids,
                        limit=limit,
                        boundary=boundary,
                    )
        except psycopg.Error as error:
            logger.warning(
                "AI candidate recommendation query failed (%s)",
                type(error).__name__,
            )
            raise RecommendationStoreUnavailable from error

        return _page_from_rows(
            rows,
            limit=limit,
            source_fingerprint=source_fingerprint,
            boundary=boundary,
            empty_reason=CandidateRecommendationReason.NO_MATCHING_CV_EMBEDDINGS,
        )

    def _job_rows(
        self,
        cursor: Cursor[Any],
        *,
        source_vector: str,
        model_name: str,
        filters: JobRecommendationFilters,
        limit: int,
        boundary: RecommendationBoundary | None,
    ) -> Sequence[tuple[UUID, float]]:
        predicates = [
            "j.is_active",
            "j.model_name = %(model_name)s",
        ]
        parameters: dict[str, object] = {
            "source_vector": source_vector,
            "model_name": model_name,
            "result_limit": limit + 1,
        }
        if filters.location is not None:
            predicates.append("lower(j.location) = lower(%(location)s)")
            parameters["location"] = filters.location
        if filters.salary_min is not None:
            predicates.append(
                "((j.salary_min IS NULL AND j.salary_max IS NULL) "
                "OR j.salary_max >= %(salary_min)s)"
            )
            parameters["salary_min"] = filters.salary_min
        if filters.job_type is not None:
            predicates.append("j.job_type = %(job_type)s")
            parameters["job_type"] = filters.job_type
        cursor_predicate = ""
        if boundary is not None:
            cursor_predicate = """
                WHERE distance > %(cursor_distance)s
                   OR (
                        distance = %(cursor_distance)s
                        AND job_id > %(cursor_id)s
                   )
            """
            parameters["cursor_distance"] = boundary.distance
            parameters["cursor_id"] = boundary.item_id

        query = f"""
            WITH scored AS (
                SELECT
                    j.job_id,
                    (
                        j.vector <=> %(source_vector)s::vector
                    )::double precision AS distance
                FROM ai.job_embeddings AS j
                WHERE {" AND ".join(predicates)}
            )
            SELECT job_id, distance
            FROM scored
            {cursor_predicate}
            ORDER BY distance ASC, job_id ASC
            LIMIT %(result_limit)s
        """
        return cursor.execute(query, parameters).fetchall()

    def _candidate_rows(
        self,
        cursor: Cursor[Any],
        *,
        source_vector: str,
        model_name: str,
        eligible_candidate_ids: Sequence[UUID],
        eligible_cv_ids: Sequence[UUID],
        limit: int,
        boundary: RecommendationBoundary | None,
    ) -> Sequence[tuple[UUID, float]]:
        parameters: dict[str, object] = {
            "source_vector": source_vector,
            "model_name": model_name,
            "eligible_candidate_ids": list(eligible_candidate_ids),
            "eligible_cv_ids": list(eligible_cv_ids),
            "result_limit": limit + 1,
        }
        cursor_predicate = ""
        if boundary is not None:
            cursor_predicate = """
                WHERE distance > %(cursor_distance)s
                   OR (
                        distance = %(cursor_distance)s
                        AND candidate_id > %(cursor_id)s
                   )
            """
            parameters["cursor_distance"] = boundary.distance
            parameters["cursor_id"] = boundary.item_id

        query = _candidate_rows_query(cursor_predicate)
        return cursor.execute(query, parameters).fetchall()

    def _connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(
            self._database_url,
            connect_timeout=self._connect_timeout_seconds,
        )

    def _start_snapshot(self, cursor: Cursor[Any]) -> None:
        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        cursor.execute(
            "SELECT set_config('statement_timeout', %s, true)",
            (str(self._statement_timeout_ms),),
        )

    def _force_exact_vector_plan(self, cursor: Cursor[Any]) -> None:
        cursor.execute("SET LOCAL enable_indexscan = off")
        cursor.execute("SET LOCAL enable_bitmapscan = off")


def _candidate_rows_query(cursor_predicate: str) -> str:
    # Materialize the authorized Candidate/CV pairs before ordering by distance.
    # A global HNSW scan with this dynamic allowlist can omit eligible neighbors,
    # which would make stateless cursor pages incomplete and non-deterministic.
    return f"""
        WITH eligible_scope(candidate_id, cv_id) AS MATERIALIZED (
            SELECT *
            FROM unnest(
                %(eligible_candidate_ids)s::uuid[],
                %(eligible_cv_ids)s::uuid[]
            )
        ),
        eligible_vectors AS MATERIALIZED (
            SELECT
                c.user_id AS candidate_id,
                c.vector
            FROM eligible_scope AS eligible
            JOIN ai.cv_embeddings AS c
              ON c.cv_id = eligible.cv_id
             AND c.user_id = eligible.candidate_id
            WHERE c.is_active
              AND c.model_name = %(model_name)s
        ),
        scored AS (
            SELECT
                candidate_id,
                (
                    vector <=> %(source_vector)s::vector
                )::double precision AS distance
            FROM eligible_vectors
        )
        SELECT candidate_id, distance
        FROM scored
        {cursor_predicate}
        ORDER BY distance ASC, candidate_id ASC
        LIMIT %(result_limit)s
    """


def _candidate_scope_arrays(
    filters: CandidateRecommendationFilters,
) -> tuple[list[UUID], list[UUID]]:
    try:
        candidates = filters.eligible_candidates
        candidate_ids = [candidate.candidate_id for candidate in candidates]
        cv_ids = [candidate.cv_id for candidate in candidates]
    except (AttributeError, TypeError) as error:
        raise RecommendationStoreUnavailable from error
    if (
        not 1 <= len(candidates) <= CANDIDATE_RECOMMENDATION_MAXIMUM_SCOPE
        or len(candidate_ids) != len(cv_ids)
        or any(not isinstance(value, UUID) for value in (*candidate_ids, *cv_ids))
        or candidate_ids != sorted(candidate_ids, key=lambda value: value.int)
        or len(set(candidate_ids)) != len(candidate_ids)
        or len(set(cv_ids)) != len(cv_ids)
    ):
        raise RecommendationStoreUnavailable
    return candidate_ids, cv_ids


def _validate_job_version(job_version: object) -> None:
    if (
        not isinstance(job_version, int)
        or isinstance(job_version, bool)
        or not 1 <= job_version <= 2_147_483_647
    ):
        raise RecommendationStoreUnavailable


def _require_exact_source_version(
    source_version: object,
    job_version: int,
) -> None:
    _validate_job_version(job_version)
    if (
        not isinstance(source_version, int)
        or isinstance(source_version, bool)
        or source_version != job_version
    ):
        raise RecommendationStoreUnavailable


def _source_empty_or_stale(
    expected_source_fingerprint: str | None,
    reason: RecommendationReason,
) -> RecommendationPage:
    if expected_source_fingerprint is not None:
        raise StaleRecommendationCursor
    return _empty_page(reason, None)


def _empty_page(
    reason: RecommendationReason,
    source_fingerprint: str | None,
) -> RecommendationPage:
    return RecommendationPage((), source_fingerprint, None, reason)


def _page_from_rows(
    rows: Sequence[tuple[UUID, float]],
    *,
    limit: int,
    source_fingerprint: str,
    boundary: RecommendationBoundary | None,
    empty_reason: RecommendationReason,
) -> RecommendationPage:
    if not rows:
        return _empty_page(empty_reason, source_fingerprint)
    selected = rows[:limit]
    items = tuple(_distance_item(row) for row in selected)
    next_boundary = None
    current_page = boundary.page + 1 if boundary is not None else 1
    if len(rows) > limit and current_page < RECOMMENDATION_MAXIMUM_PAGES:
        last = items[-1]
        next_boundary = RecommendationBoundary(
            distance=last.distance,
            item_id=last.item_id,
            page=current_page,
        )
    return RecommendationPage(items, source_fingerprint, next_boundary, None)


def _distance_item(row: Sequence[object]) -> RecommendationDistanceItem:
    try:
        item_id = row[0]
        distance = float(row[1])
    except (IndexError, TypeError, ValueError, OverflowError) as error:
        raise RecommendationStoreUnavailable from error
    if (
        not isinstance(item_id, UUID)
        or not math.isfinite(distance)
        or distance < 0.0
        or distance > 2.0
    ):
        raise RecommendationStoreUnavailable
    return RecommendationDistanceItem(item_id=item_id, distance=distance)


def _validate_target_counts(active_count: object, compatible_count: object) -> None:
    if (
        not isinstance(active_count, int)
        or isinstance(active_count, bool)
        or active_count < 0
        or not isinstance(compatible_count, int)
        or isinstance(compatible_count, bool)
        or compatible_count < 0
        or compatible_count > active_count
    ):
        raise RecommendationStoreUnavailable


def _source_fingerprint(
    *,
    kind: str,
    source_id: UUID,
    model_name: str,
    text_hash: str,
    source_version: int | None,
    source_updated_at: datetime,
    source_vector: str,
    target_generation: int,
) -> str:
    valid_source_version = source_version is None or (
        isinstance(source_version, int)
        and not isinstance(source_version, bool)
        and source_version >= 0
    )
    try:
        source_vector_bytes = (
            source_vector.encode("ascii") if isinstance(source_vector, str) else b""
        )
    except UnicodeEncodeError as error:
        raise RecommendationStoreUnavailable from error
    if (
        kind not in {"jobs", "candidates"}
        or not isinstance(source_id, UUID)
        or not isinstance(model_name, str)
        or not model_name.strip()
        or len(model_name) > 128
        or not isinstance(text_hash, str)
        or not _HASH_PATTERN.fullmatch(text_hash)
        or not valid_source_version
        or not isinstance(source_updated_at, datetime)
        or source_updated_at.tzinfo is None
        or not isinstance(source_vector, str)
        or not 1 <= len(source_vector) <= 32_768
        or not isinstance(target_generation, int)
        or isinstance(target_generation, bool)
        or target_generation <= 0
    ):
        raise RecommendationStoreUnavailable
    value = {
        "kind": kind,
        "model_name": model_name,
        "source_id": str(source_id),
        "source_updated_at": source_updated_at.isoformat(),
        "source_version": source_version,
        "source_vector_hash": hashlib.sha256(source_vector_bytes).hexdigest(),
        "target_generation": target_generation,
        "text_hash": text_hash,
    }
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _require_current_snapshot(
    expected: str | None,
    actual: str,
) -> None:
    if expected is not None and expected != actual:
        raise StaleRecommendationCursor
