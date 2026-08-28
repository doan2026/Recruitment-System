"""Candidate-facing job recommendation HTTP contract tests."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import MatchResult
from app.main import create_app
from app.recommendation import (
    JobRecommendationFilters,
    JobRecommendationReason,
    RecommendationBoundary,
    RecommendationCursorCodec,
    RecommendationDistanceItem,
    RecommendationKind,
    RecommendationPage,
    RecommendationStoreUnavailable,
    StaleRecommendationCursor,
)

MATCH_KEY = "legacy-match-key"
SCOPED_KEY = "job-search-scoped-internal-key-000001"
CANDIDATE_SCOPED_KEY = "job-search-candidate-scoped-key-000001"
CV_ID = UUID("10000000-0000-0000-0000-000000000001")
JOB_1 = UUID("20000000-0000-0000-0000-000000000001")
JOB_2 = UUID("20000000-0000-0000-0000-000000000002")
SOURCE_FINGERPRINT = "a" * 64
AUTH_HEADERS = {
    "X-Internal-Api-Key": SCOPED_KEY,
    "X-Internal-Service": "job-search-service",
}


class UnusedMatchRepository:
    def calculate(self, *_: object) -> MatchResult:
        raise AssertionError("match repository must not be called")


@dataclass
class StubRecommendationRepository:
    outcomes: list[RecommendationPage | Exception]
    calls: list[
        tuple[
            UUID,
            JobRecommendationFilters,
            int,
            RecommendationBoundary | None,
            str | None,
        ]
    ] = field(default_factory=list)

    def recommend_jobs(
        self,
        cv_id: UUID,
        filters: JobRecommendationFilters,
        *,
        limit: int,
        boundary: RecommendationBoundary | None,
        expected_source_fingerprint: str | None,
    ) -> RecommendationPage:
        self.calls.append(
            (
                cv_id,
                filters,
                limit,
                boundary,
                expected_source_fingerprint,
            )
        )
        outcome = self.outcomes[len(self.calls) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def recommend_candidates(self, *_: object, **__: object) -> RecommendationPage:
        raise AssertionError("candidate recommendation is not an HTTP surface")


def test_recommend_jobs_returns_ranked_items_and_round_trips_cursor() -> None:
    first_page = RecommendationPage(
        items=(
            RecommendationDistanceItem(JOB_1, 0.0),
            RecommendationDistanceItem(JOB_2, 0.5),
        ),
        source_fingerprint=SOURCE_FINGERPRINT,
        next_boundary=RecommendationBoundary(0.5, JOB_2, page=1),
        reason=None,
    )
    third_job = UUID("20000000-0000-0000-0000-000000000003")
    second_page = RecommendationPage(
        items=(RecommendationDistanceItem(third_job, 1.0),),
        source_fingerprint=SOURCE_FINGERPRINT,
        next_boundary=None,
        reason=None,
    )
    repository = StubRecommendationRepository([first_page, second_page])

    with make_client(repository) as client:
        first = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "limit": 2},
        )
        cursor = first.json()["data"]["next_cursor"]
        second = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "limit": 2, "cursor": cursor},
        )

    assert first.status_code == 200
    assert first.json() == {
        "data": {
            "cv_id": str(CV_ID),
            "items": [
                {"job_id": str(JOB_1), "score": 1.0},
                {"job_id": str(JOB_2), "score": 0.75},
            ],
            "next_cursor": cursor,
            "reason": None,
        },
        "meta": None,
    }
    assert isinstance(cursor, str)
    assert len(cursor.encode("ascii")) <= 1024
    assert str(CV_ID) not in cursor
    assert second.status_code == 200
    assert second.json()["data"] == {
        "cv_id": str(CV_ID),
        "items": [{"job_id": str(third_job), "score": 0.5}],
        "next_cursor": None,
        "reason": None,
    }
    assert repository.calls[1][3] == RecommendationBoundary(0.5, JOB_2, page=1)
    assert repository.calls[1][4] == SOURCE_FINGERPRINT


@pytest.mark.parametrize("reason", list(JobRecommendationReason))
def test_recommend_jobs_returns_stable_empty_reason(
    reason: JobRecommendationReason,
) -> None:
    repository = StubRecommendationRepository(
        [RecommendationPage((), None, None, reason)]
    )

    with make_client(repository) as client:
        response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID)},
        )

    assert response.status_code == 200
    assert response.json() == {
        "data": {
            "cv_id": str(CV_ID),
            "items": [],
            "next_cursor": None,
            "reason": reason.value,
        },
        "meta": None,
    }


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Internal-Api-Key": SCOPED_KEY},
        {
            "X-Internal-Api-Key": SCOPED_KEY,
            "X-Internal-Service": "application-service",
        },
        {
            "X-Internal-Api-Key": MATCH_KEY,
            "X-Internal-Service": "job-search-service",
        },
        {
            "X-Internal-Api-Key": "wrong",
            "X-Internal-Service": "job-search-service",
        },
    ],
)
def test_recommend_jobs_requires_exact_direction_scoped_caller(
    headers: dict[str, str],
) -> None:
    repository = StubRecommendationRepository(
        [
            RecommendationPage(
                (),
                None,
                None,
                JobRecommendationReason.CV_EMBEDDING_NOT_FOUND,
            )
        ]
    )

    with make_client(repository) as client:
        response = client.post(
            "/recommend/jobs",
            headers=headers,
            json={"cv_id": str(CV_ID)},
        )

    assert response.status_code == 401
    assert response.json() == {
        "code": "INVALID_INTERNAL_CALLER",
        "message": "A valid scoped internal caller is required",
        "details": None,
    }
    assert repository.calls == []


@pytest.mark.parametrize(
    "payload",
    [
        {"cv_id": str(CV_ID), "limit": 0},
        {"cv_id": str(CV_ID), "limit": 51},
        {"cv_id": str(CV_ID), "limit": "10"},
        {"cv_id": str(CV_ID), "limit": True},
        {"cv_id": str(CV_ID), "cursor": "x" * 1025},
        {"cv_id": str(CV_ID), "salary_min": "-0.01"},
        {"cv_id": str(CV_ID), "salary_min": "1.001"},
        {"cv_id": str(CV_ID), "job_type": "CONTRACT"},
        {"cv_id": str(CV_ID), "extra": True},
        {"cv_id": str(CV_ID), "location": "Ha\nNoi"},
        {"cv_id": str(CV_ID), "location": "Ha%Noi"},
        {"cv_id": str(CV_ID), "location": "Ha_Noi"},
        {"cv_id": str(CV_ID), "location": "Ha\\Noi"},
        {"cv_id": str(CV_ID), "location": "\ufb03" * 100},
    ],
)
def test_recommend_jobs_rejects_invalid_or_unbounded_request(
    payload: dict[str, object],
) -> None:
    repository = StubRecommendationRepository([])

    with make_client(repository) as client:
        response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json=payload,
        )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert repository.calls == []


def test_recommend_jobs_normalizes_location_before_length_constraints() -> None:
    repository = StubRecommendationRepository(
        [
            RecommendationPage(
                (),
                SOURCE_FINGERPRINT,
                None,
                JobRecommendationReason.NO_MATCHING_JOB_EMBEDDINGS,
            )
        ]
    )
    raw_location = "  Hà" + (" " * 300) + "Nội  "

    with make_client(repository) as client:
        response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "location": raw_location},
        )

    assert response.status_code == 200
    assert repository.calls[0][1].location == "Hà Nội"


def test_recommend_jobs_rejects_tampered_or_filter_mismatched_cursor() -> None:
    page = RecommendationPage(
        (RecommendationDistanceItem(JOB_1, 0.25),),
        SOURCE_FINGERPRINT,
        RecommendationBoundary(0.25, JOB_1, page=1),
        None,
    )
    repository = StubRecommendationRepository([page])

    with make_client(repository) as client:
        first = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID)},
        )
        cursor = first.json()["data"]["next_cursor"]
        tampered = cursor[:-1] + ("A" if cursor[-1] != "A" else "B")
        tampered_response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "cursor": tampered},
        )
        filter_response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={
                "cv_id": str(CV_ID),
                "cursor": cursor,
                "location": "Ha Noi",
            },
        )

    for response in (tampered_response, filter_response):
        assert response.status_code == 409
        assert response.json()["code"] == "RECOMMENDATION_CURSOR_STALE"
    assert len(repository.calls) == 1


def test_recommend_jobs_rejects_noncanonical_cursor_padding() -> None:
    page = RecommendationPage(
        (RecommendationDistanceItem(JOB_1, 0.25),),
        SOURCE_FINGERPRINT,
        RecommendationBoundary(0.25, JOB_1, page=1),
        None,
    )
    repository = StubRecommendationRepository([page])

    with make_client(repository) as client:
        first = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID)},
        )
        payload, signature = first.json()["data"]["next_cursor"].split(".")
        response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={
                "cv_id": str(CV_ID),
                "cursor": f"{payload}.{signature}=",
            },
        )

    assert response.status_code == 409
    assert response.json()["code"] == "RECOMMENDATION_CURSOR_STALE"
    assert len(repository.calls) == 1


@pytest.mark.parametrize(
    "failure",
    [
        RecommendationStoreUnavailable(),
        StaleRecommendationCursor(),
    ],
)
def test_recommend_jobs_maps_repository_failures_safely(
    failure: Exception,
) -> None:
    repository = StubRecommendationRepository([failure])

    with make_client(repository) as client:
        response = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID)},
        )

    expected_status = 409 if isinstance(failure, StaleRecommendationCursor) else 503
    assert response.status_code == expected_status
    assert "vector" not in response.text.lower()


def test_recommend_jobs_caps_pagination_at_ten_result_pages() -> None:
    pages: list[RecommendationPage] = []
    for index in range(10):
        item_id = UUID(f"20000000-0000-0000-0000-{index + 1:012d}")
        distance = index / 20
        pages.append(
            RecommendationPage(
                (RecommendationDistanceItem(item_id, distance),),
                SOURCE_FINGERPRINT,
                (
                    RecommendationBoundary(distance, item_id, page=index + 1)
                    if index < 9
                    else None
                ),
                None,
            )
        )
    repository = StubRecommendationRepository(pages)

    with make_client(repository) as client:
        cursor = None
        for _ in range(10):
            body = {"cv_id": str(CV_ID)}
            if cursor is not None:
                body["cursor"] = cursor
            response = client.post(
                "/recommend/jobs",
                headers=AUTH_HEADERS,
                json=body,
            )
            assert response.status_code == 200
            cursor = response.json()["data"]["next_cursor"]
        assert cursor is None

        filter_fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "job_type": None,
                    "location": None,
                    "salary_min": None,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        page_ten_cursor = RecommendationCursorCodec(SCOPED_KEY).encode(
            kind=RecommendationKind.JOBS,
            source_fingerprint=SOURCE_FINGERPRINT,
            filter_fingerprint=filter_fingerprint,
            boundary=RecommendationBoundary(0.5, JOB_1, page=10),
        )
        blocked = client.post(
            "/recommend/jobs",
            headers=AUTH_HEADERS,
            json={"cv_id": str(CV_ID), "cursor": page_ten_cursor},
        )

    assert blocked.status_code == 409
    assert blocked.json()["code"] == "RECOMMENDATION_CURSOR_STALE"
    assert len(repository.calls) == 10


def test_openapi_exposes_jobs_only_and_scoped_security() -> None:
    repository = StubRecommendationRepository([])

    with make_client(repository) as client:
        schema = client.get("/openapi.json").json()

    assert "/recommend/jobs" in schema["paths"]
    assert "/recommend/candidates" in schema["paths"]
    operation = schema["paths"]["/recommend/jobs"]["post"]
    assert operation["security"] == [{"JobSearchInternalApiKey": []}]
    assert set(operation["responses"]) == {"200", "401", "409", "422", "503"}
    parameters = operation["parameters"]
    service_header = next(
        item for item in parameters if item["name"] == "X-Internal-Service"
    )
    # Missing and incorrect caller headers share the same non-oracle 401.
    assert service_header["required"] is False


def make_client(
    repository: StubRecommendationRepository,
) -> TestClient:
    return TestClient(
        create_app(
            settings=Settings(
                database_url="postgresql://unused-for-unit-tests",
                internal_api_key=MATCH_KEY,
                internal_api_key_job_search=SCOPED_KEY,
                internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
            ),
            match_repository=UnusedMatchRepository(),
            recommendation_repository=repository,
        )
    )
