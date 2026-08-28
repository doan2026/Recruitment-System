"""Recommendation repository safety boundary tests."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.recommendation import (
    CandidateEligibility,
    CandidateRecommendationFilters,
    RecommendationStoreUnavailable,
)
from app.recommendation_repository import (
    PsycopgRecommendationRepository,
    _candidate_scope_arrays,
    _distance_item,
    _require_exact_source_version,
    _source_fingerprint,
    _validate_target_counts,
)

SOURCE_ID = UUID("10000000-0000-0000-0000-000000000001")
CANDIDATE_ID = UUID("20000000-0000-0000-0000-000000000001")


class RecordingCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object | None]] = []

    def execute(
        self,
        query: str,
        parameters: object | None = None,
    ) -> RecordingCursor:
        self.calls.append((query, parameters))
        return self

    def fetchall(self) -> list[tuple[UUID, float]]:
        return []


def test_exact_plan_is_not_forced_during_source_snapshot_setup() -> None:
    cursor = RecordingCursor()
    repository = PsycopgRecommendationRepository(
        "postgresql://unused",
        connect_timeout_seconds=2,
        statement_timeout_ms=2_000,
    )

    repository._start_snapshot(cursor)  # type: ignore[arg-type]

    assert [query for query, _ in cursor.calls] == [
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
        "SELECT set_config('statement_timeout', %s, true)",
    ]
    assert all("enable_indexscan" not in query for query, _ in cursor.calls)

    repository._force_exact_vector_plan(cursor)  # type: ignore[arg-type]

    assert [query for query, _ in cursor.calls[-2:]] == [
        "SET LOCAL enable_indexscan = off",
        "SET LOCAL enable_bitmapscan = off",
    ]


def test_candidate_query_joins_parallel_candidate_cv_scope_exactly() -> None:
    cursor = RecordingCursor()
    repository = PsycopgRecommendationRepository(
        "postgresql://unused",
        connect_timeout_seconds=2,
        statement_timeout_ms=2_000,
    )
    filters = CandidateRecommendationFilters(
        (CandidateEligibility(CANDIDATE_ID, SOURCE_ID, 1, 1),)
    )
    candidate_ids, cv_ids = _candidate_scope_arrays(filters)

    rows = repository._candidate_rows(  # type: ignore[arg-type]
        cursor,
        source_vector="[1,0]",
        model_name="model-v1",
        eligible_candidate_ids=candidate_ids,
        eligible_cv_ids=cv_ids,
        limit=10,
        boundary=None,
    )

    assert rows == []
    query, parameters = cursor.calls[-1]
    assert "eligible_scope(candidate_id, cv_id) AS MATERIALIZED" in query
    assert "eligible_vectors AS MATERIALIZED" in query
    assert "c.user_id = eligible.candidate_id" in query
    assert "c.cv_id = eligible.cv_id" in query
    assert "c.cv_id = ANY" not in query
    assert "enable_indexscan" not in query
    assert parameters["eligible_candidate_ids"] == [CANDIDATE_ID]
    assert parameters["eligible_cv_ids"] == [SOURCE_ID]


@pytest.mark.parametrize("source_version", [None, 1, 3, True])
def test_candidate_source_version_must_match_authorized_job_exactly(
    source_version: object,
) -> None:
    with pytest.raises(RecommendationStoreUnavailable):
        _require_exact_source_version(source_version, 2)

    _require_exact_source_version(2, 2)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("model_name", object()),
        ("text_hash", "not-a-hash"),
        ("source_version", True),
        ("source_updated_at", "not-a-timestamp"),
        ("source_updated_at", datetime(2026, 8, 28)),
        ("source_vector", object()),
        ("source_vector", ""),
        ("source_vector", "[khóa]"),
        ("target_generation", 0),
        ("target_generation", True),
    ],
)
def test_source_fingerprint_rejects_corrupt_database_values(
    field: str,
    value: object,
) -> None:
    values: dict[str, object] = {
        "kind": "jobs",
        "source_id": SOURCE_ID,
        "model_name": "model-v1",
        "text_hash": "a" * 64,
        "source_version": 1,
        "source_updated_at": datetime(2026, 8, 28, tzinfo=UTC),
        "source_vector": "[1,0]",
        "target_generation": 1,
    }
    values[field] = value

    with pytest.raises(RecommendationStoreUnavailable):
        _source_fingerprint(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize("distance", [float("nan"), float("inf"), -0.1, 2.1])
def test_distance_row_rejects_non_finite_or_out_of_range_values(
    distance: float,
) -> None:
    with pytest.raises(RecommendationStoreUnavailable):
        _distance_item((SOURCE_ID, distance))


@pytest.mark.parametrize(
    ("active", "compatible"),
    [(True, 0), (0, False), (-1, 0), (1, -1), (1, 2)],
)
def test_target_counts_reject_corrupt_database_values(
    active: object,
    compatible: object,
) -> None:
    with pytest.raises(RecommendationStoreUnavailable):
        _validate_target_counts(active, compatible)
