"""PostgreSQL recommendation correctness and cursor-snapshot tests."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.recommendation import (
    CandidateEligibility,
    CandidateRecommendationFilters,
)
from app.recommendation_repository import PsycopgRecommendationRepository

pytestmark = pytest.mark.integration

MATCH_KEY = "integration-test-internal-key"
SCOPED_KEY = "integration-job-search-key-00000001"
CANDIDATE_SCOPED_KEY = "integration-candidate-key-00000000001"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CV_ID = UUID("10000000-0000-0000-0000-000000000001")
USER_ID = UUID("11000000-0000-0000-0000-000000000001")
AUTH_HEADERS = {
    "X-Internal-Api-Key": SCOPED_KEY,
    "X-Internal-Service": "job-search-service",
}
CANDIDATE_AUTH_HEADERS = {
    "X-Internal-Api-Key": CANDIDATE_SCOPED_KEY,
    "X-Internal-Service": "job-search-service",
}


def test_recommend_jobs_filters_and_paginates_exactly_without_skips(
    database_url: str,
) -> None:
    _insert_cv(database_url, CV_ID, USER_ID)
    matching_ids: list[UUID] = []
    for index in range(60):
        job_id = _job_id(index + 1)
        matches = index % 2 == 0
        if matches:
            matching_ids.append(job_id)
        _insert_job(
            database_url,
            job_id,
            vector=_vector(1.0, index / 100.0),
            location="HA NOI" if matches else "Ha Noi South",
            salary_min=None if index % 4 == 0 else Decimal("25.00"),
            salary_max=None if index % 4 == 0 else Decimal("50.00"),
            job_type="FULL_TIME" if matches else "PART_TIME",
        )

    with _client(database_url) as client:
        first = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={
                "cv_id": str(CV_ID),
                "limit": 10,
                "location": "ha noi",
                "salary_min": "30.00",
                "job_type": "FULL_TIME",
            },
        )
        cursor = first.json()["data"]["next_cursor"]
        second = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={
                "cv_id": str(CV_ID),
                "limit": 10,
                "cursor": cursor,
                "location": "ha noi",
                "salary_min": "30.00",
                "job_type": "FULL_TIME",
            },
        )

    assert first.status_code == 200
    assert second.status_code == 200
    first_ids = [UUID(item["job_id"]) for item in first.json()["data"]["items"]]
    second_ids = [UUID(item["job_id"]) for item in second.json()["data"]["items"]]
    assert first_ids + second_ids == matching_ids[:20]
    assert set(first_ids).isdisjoint(second_ids)
    assert cursor is not None
    assert str(CV_ID) not in cursor
    assert first.json()["data"]["reason"] is None
    assert second.json()["data"]["reason"] is None


@pytest.mark.parametrize(
    ("scenario", "reason"),
    [
        ("missing-cv", "CV_EMBEDDING_NOT_FOUND"),
        ("inactive-cv", "CV_EMBEDDING_INACTIVE"),
        ("no-active-jobs", "NO_ACTIVE_JOB_EMBEDDINGS"),
        ("model-mismatch", "EMBEDDING_MODEL_MISMATCH"),
        ("filter-mismatch", "NO_MATCHING_JOB_EMBEDDINGS"),
    ],
)
def test_recommend_jobs_returns_stable_empty_reasons(
    database_url: str,
    scenario: str,
    reason: str,
) -> None:
    if scenario != "missing-cv":
        _insert_cv(
            database_url,
            CV_ID,
            USER_ID,
            is_active=scenario != "inactive-cv",
        )
    if scenario == "no-active-jobs":
        _insert_job(database_url, _job_id(1), is_active=False)
    elif scenario == "model-mismatch":
        _insert_job(database_url, _job_id(1), model_name="different-model")
    elif scenario == "filter-mismatch":
        _insert_job(database_url, _job_id(1), location="Da Nang")

    payload: dict[str, object] = {"cv_id": str(CV_ID)}
    if scenario == "filter-mismatch":
        payload["location"] = "Ha Noi"
    with _client(database_url) as client:
        response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json=payload,
        )

    assert response.status_code == 200
    assert response.json()["data"] == {
        "cv_id": str(CV_ID),
        "items": [],
        "next_cursor": None,
        "reason": reason,
    }


def test_cursor_is_stale_after_target_mutation(database_url: str) -> None:
    _insert_cv(database_url, CV_ID, USER_ID)
    _insert_job(database_url, _job_id(1))
    _insert_job(database_url, _job_id(2), vector=_vector(1.0, 0.2))

    with _client(database_url) as client:
        first = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "limit": 1},
        )
        cursor = first.json()["data"]["next_cursor"]
        with psycopg.connect(database_url) as connection:
            connection.execute(
                "UPDATE ai.job_embeddings SET location = 'Hue' WHERE job_id = %s",
                (_job_id(2),),
            )
        stale = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "limit": 1, "cursor": cursor},
        )

    assert first.status_code == 200
    assert stale.status_code == 409
    assert stale.json()["code"] == "RECOMMENDATION_CURSOR_STALE"


def test_cursor_is_stale_after_source_vector_only_mutation(
    database_url: str,
) -> None:
    _insert_cv(database_url, CV_ID, USER_ID)
    _insert_job(database_url, _job_id(1))
    _insert_job(database_url, _job_id(2), vector=_vector(1.0, 0.2))

    with _client(database_url) as client:
        first = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "limit": 1},
        )
        cursor = first.json()["data"]["next_cursor"]
        with psycopg.connect(database_url) as connection:
            connection.execute(
                "UPDATE ai.cv_embeddings SET vector = %s::vector WHERE cv_id = %s",
                (_vector(0.0, 1.0), CV_ID),
            )
        stale = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "limit": 1, "cursor": cursor},
        )

    assert stale.status_code == 409
    assert stale.json()["code"] == "RECOMMENDATION_CURSOR_STALE"


def test_job_generation_tracks_real_mutations_but_not_zero_rows_or_rollback(
    database_url: str,
) -> None:
    start = _generation(database_url, "JOBS")
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE ai.job_embeddings SET location = 'Hue' WHERE job_id = %s",
            (_job_id(999),),
        )
    assert _generation(database_url, "JOBS") == start

    _insert_job(database_url, _job_id(1))
    assert _generation(database_url, "JOBS") == start + 1

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE ai.job_embeddings SET location = 'rolled back' WHERE job_id = %s",
            (_job_id(1),),
        )
        connection.rollback()
    assert _generation(database_url, "JOBS") == start + 1

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE ai.job_embeddings SET location = 'Hue' WHERE job_id = %s",
            (_job_id(1),),
        )
    assert _generation(database_url, "JOBS") == start + 2

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "DELETE FROM ai.job_embeddings WHERE job_id = %s",
            (_job_id(1),),
        )
    assert _generation(database_url, "JOBS") == start + 3

    with psycopg.connect(database_url) as connection:
        connection.execute("TRUNCATE ai.job_embeddings")
    assert _generation(database_url, "JOBS") == start + 4


def test_private_candidate_query_uses_only_selected_cvs_once_per_user(
    database_url: str,
) -> None:
    job_id = _job_id(1)
    other_user = UUID("11000000-0000-0000-0000-000000000002")
    _insert_job(database_url, job_id)
    _insert_cv(database_url, CV_ID, USER_ID, vector=_vector(1.0, 0.5))
    _insert_cv(
        database_url,
        UUID("10000000-0000-0000-0000-000000000002"),
        USER_ID,
        vector=_vector(1.0, 0.1),
    )
    _insert_cv(
        database_url,
        UUID("10000000-0000-0000-0000-000000000003"),
        other_user,
        vector=_vector(1.0, 0.2),
    )

    page = _repository(database_url).recommend_candidates(
        job_id,
        CandidateRecommendationFilters(
            (
                CandidateEligibility(USER_ID, CV_ID, 1, 1),
                CandidateEligibility(
                    other_user,
                    UUID("10000000-0000-0000-0000-000000000003"),
                    1,
                    1,
                ),
            )
        ),
        job_version=1,
        limit=10,
        boundary=None,
        expected_source_fingerprint=None,
    )

    # The better second CV for USER_ID was not selected by consent and must
    # not influence the ranking.
    assert [item.item_id for item in page.items] == [other_user, USER_ID]
    assert page.reason is None


def test_recommend_candidates_http_ranks_only_exact_selected_cvs(
    database_url: str,
) -> None:
    job_id = _job_id(1)
    candidate_b = UUID("11000000-0000-0000-0000-000000000002")
    candidate_c = UUID("11000000-0000-0000-0000-000000000003")
    cv_a_unselected = UUID("10000000-0000-0000-0000-000000000002")
    cv_b = UUID("10000000-0000-0000-0000-000000000003")
    cv_c = UUID("10000000-0000-0000-0000-000000000004")
    _insert_job(database_url, job_id)
    _insert_cv(database_url, CV_ID, USER_ID, vector=_vector(1.0, 0.5))
    _insert_cv(
        database_url,
        cv_a_unselected,
        USER_ID,
        vector=_vector(1.0, 0.0),
    )
    _insert_cv(database_url, cv_b, candidate_b, vector=_vector(1.0, 0.2))
    _insert_cv(database_url, cv_c, candidate_c, vector=_vector(1.0, 0.0))

    with _client(database_url) as client:
        response = client.post(
            "/recommend/candidates",
            headers=CANDIDATE_AUTH_HEADERS,
            json={
                "job_id": str(job_id),
                "job_version": 1,
                "eligible_candidates": [
                    {
                        "candidate_id": str(USER_ID),
                        "cv_id": str(CV_ID),
                        "discovery_version": 1,
                        "profile_version": 1,
                    },
                    {
                        "candidate_id": str(candidate_b),
                        "cv_id": str(cv_b),
                        "discovery_version": 1,
                        "profile_version": 1,
                    },
                ],
                "limit": 10,
            },
        )

    assert response.status_code == 200
    assert [
        UUID(item["candidate_id"]) for item in response.json()["data"]["items"]
    ] == [candidate_b, USER_ID]
    assert candidate_c not in {
        UUID(item["candidate_id"]) for item in response.json()["data"]["items"]
    }
    assert response.json()["data"]["next_cursor"] is None
    assert response.json()["data"]["reason"] is None


def test_candidate_repository_rejects_mismatched_candidate_cv_pair(
    database_url: str,
) -> None:
    job_id = _job_id(1)
    actual_owner = UUID("11000000-0000-0000-0000-000000000002")
    mismatched_cv = UUID("10000000-0000-0000-0000-000000000002")
    _insert_job(database_url, job_id)
    _insert_cv(database_url, mismatched_cv, actual_owner)

    page = _repository(database_url).recommend_candidates(
        job_id,
        CandidateRecommendationFilters(
            (CandidateEligibility(USER_ID, mismatched_cv, 1, 1),)
        ),
        job_version=1,
        limit=10,
        boundary=None,
        expected_source_fingerprint=None,
    )

    assert page.items == ()
    assert page.reason is not None
    assert page.reason.value == "NO_ACTIVE_CV_EMBEDDINGS"


@pytest.mark.parametrize("embedded_version", [1, 3])
def test_candidate_recommendation_requires_exact_job_source_version(
    database_url: str,
    embedded_version: int,
) -> None:
    job_id = _job_id(1)
    _insert_job(database_url, job_id, source_version=embedded_version)
    _insert_cv(database_url, CV_ID, USER_ID)

    with _client(database_url) as client:
        response = client.post(
            "/recommend/candidates",
            headers=CANDIDATE_AUTH_HEADERS,
            json={
                "job_id": str(job_id),
                "job_version": 2,
                "eligible_candidates": [
                    {
                        "candidate_id": str(USER_ID),
                        "cv_id": str(CV_ID),
                        "discovery_version": 1,
                        "profile_version": 1,
                    }
                ],
            },
        )

    assert response.status_code == 503
    assert response.json()["code"] == "AI_SERVICE_UNAVAILABLE"


def _client(database_url: str) -> TestClient:
    return TestClient(
        create_app(
            settings=Settings(
                database_url=database_url,
                internal_api_key=MATCH_KEY,
                internal_api_key_job_search=SCOPED_KEY,
                internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
            )
        )
    )


def _repository(database_url: str) -> PsycopgRecommendationRepository:
    return PsycopgRecommendationRepository(
        database_url,
        connect_timeout_seconds=2,
        statement_timeout_ms=5_000,
    )


def _insert_cv(
    database_url: str,
    cv_id: UUID,
    user_id: UUID,
    *,
    vector: str | None = None,
    model_name: str = MODEL_NAME,
    is_active: bool = True,
) -> None:
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            INSERT INTO ai.cv_embeddings (
                cv_id, user_id, vector, text_hash, model_name,
                source_version, is_active
            ) VALUES (%s, %s, %s::vector, %s, %s, 1, %s)
            """,
            (
                cv_id,
                user_id,
                vector or _vector(1.0, 0.0),
                "a" * 64,
                model_name,
                is_active,
            ),
        )


def _insert_job(
    database_url: str,
    job_id: UUID,
    *,
    vector: str | None = None,
    model_name: str = MODEL_NAME,
    location: str | None = "Ha Noi",
    salary_min: Decimal | None = Decimal("20.00"),
    salary_max: Decimal | None = Decimal("40.00"),
    job_type: str | None = "FULL_TIME",
    is_active: bool = True,
    source_version: int = 1,
) -> None:
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            INSERT INTO ai.job_embeddings (
                job_id, vector, text_hash, model_name, location,
                salary_min, salary_max, job_type, is_active, source_version
            ) VALUES (%s, %s::vector, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                job_id,
                vector or _vector(1.0, 0.0),
                "b" * 64,
                model_name,
                location,
                salary_min,
                salary_max,
                job_type,
                is_active,
                source_version,
            ),
        )


def _generation(database_url: str, target_type: str) -> int:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT generation
            FROM ai.recommendation_generations
            WHERE target_type = %s
            """,
            (target_type,),
        ).fetchone()
    assert row is not None
    return row[0]


def _job_id(number: int) -> UUID:
    return UUID(f"20000000-0000-0000-0000-{number:012d}")


def _vector(first: float, second: float) -> str:
    values = [first, second, *([0.0] * 382)]
    return "[" + ",".join(str(value) for value in values) + "]"
