"""Consent-scoped recruiter candidate recommendation HTTP tests."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import MatchResult
from app.main import create_app
from app.recommendation import (
    CandidateRecommendationFilters,
    CandidateRecommendationReason,
    RecommendationBoundary,
    RecommendationDistanceItem,
    RecommendationPage,
)

MATCH_KEY = "legacy-match-key"
JOB_RECOMMENDATION_KEY = "job-search-scoped-internal-key-000001"
CANDIDATE_KEY = "job-search-candidate-scoped-key-000001"
JOB_ID = UUID("20000000-0000-0000-0000-000000000001")
JOB_VERSION = 7
CANDIDATE_A = UUID("10000000-0000-0000-0000-000000000001")
CANDIDATE_B = UUID("10000000-0000-0000-0000-000000000002")
CANDIDATE_C = UUID("10000000-0000-0000-0000-000000000003")
CV_A = UUID("30000000-0000-0000-0000-000000000001")
CV_B = UUID("30000000-0000-0000-0000-000000000002")
SOURCE_FINGERPRINT = "c" * 64
AUTH_HEADERS = {
    "X-Internal-Api-Key": CANDIDATE_KEY,
    "X-Internal-Service": "job-search-service",
}


class UnusedMatchRepository:
    def calculate(self, *_: object) -> MatchResult:
        raise AssertionError("match repository must not be called")


@dataclass
class StubRecommendationRepository:
    outcomes: list[RecommendationPage]
    calls: list[
        tuple[
            UUID,
            CandidateRecommendationFilters,
            int,
            int,
            RecommendationBoundary | None,
            str | None,
        ]
    ] = field(default_factory=list)

    def recommend_jobs(self, *_: object, **__: object) -> RecommendationPage:
        raise AssertionError("job recommendation must not be called")

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
        self.calls.append(
            (
                job_id,
                filters,
                job_version,
                limit,
                boundary,
                expected_source_fingerprint,
            )
        )
        return self.outcomes[len(self.calls) - 1]


def eligibility(
    candidate_id: UUID,
    cv_id: UUID,
    *,
    discovery_version: int = 1,
    profile_version: int = 1,
) -> dict[str, object]:
    return {
        "candidate_id": str(candidate_id),
        "cv_id": str(cv_id),
        "discovery_version": discovery_version,
        "profile_version": profile_version,
    }


def request_body(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "job_id": str(JOB_ID),
        "job_version": JOB_VERSION,
        "eligible_candidates": [
            eligibility(CANDIDATE_A, CV_A),
            eligibility(CANDIDATE_B, CV_B, discovery_version=2),
        ],
        "limit": 10,
    }
    value.update(overrides)
    return value


def test_recommend_candidates_returns_only_consent_scoped_ranked_ids() -> None:
    page = RecommendationPage(
        items=(
            RecommendationDistanceItem(CANDIDATE_A, 0.0),
            RecommendationDistanceItem(CANDIDATE_B, 0.5),
        ),
        source_fingerprint=SOURCE_FINGERPRINT,
        next_boundary=RecommendationBoundary(0.5, CANDIDATE_B, page=1),
        reason=None,
    )
    repository = StubRecommendationRepository([page])

    with make_client(repository) as client:
        response = client.post(
            "/recommend/candidates",
            headers=AUTH_HEADERS,
            json=request_body(limit=2),
        )

    assert response.status_code == 200
    cursor = response.json()["data"]["next_cursor"]
    assert response.json() == {
        "data": {
            "job_id": str(JOB_ID),
            "items": [
                {"candidate_id": str(CANDIDATE_A), "score": 1.0},
                {"candidate_id": str(CANDIDATE_B), "score": 0.75},
            ],
            "next_cursor": cursor,
            "reason": None,
        },
        "meta": None,
    }
    assert isinstance(cursor, str)
    assert str(CANDIDATE_A) not in cursor
    job_id, filters, job_version, limit, boundary, fingerprint = repository.calls[0]
    assert job_id == JOB_ID
    assert job_version == JOB_VERSION
    assert limit == 2
    assert boundary is None
    assert fingerprint is None
    assert [item.candidate_id for item in filters.eligible_candidates] == [
        CANDIDATE_A,
        CANDIDATE_B,
    ]
    assert [item.cv_id for item in filters.eligible_candidates] == [CV_A, CV_B]


@pytest.mark.parametrize("reason", list(CandidateRecommendationReason))
def test_recommend_candidates_returns_stable_empty_reason(
    reason: CandidateRecommendationReason,
) -> None:
    repository = StubRecommendationRepository(
        [RecommendationPage((), None, None, reason)]
    )

    with make_client(repository) as client:
        response = client.post(
            "/recommend/candidates",
            headers=AUTH_HEADERS,
            json=request_body(),
        )

    assert response.status_code == 200
    assert response.json()["data"] == {
        "job_id": str(JOB_ID),
        "items": [],
        "next_cursor": None,
        "reason": reason.value,
    }


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Internal-Api-Key": CANDIDATE_KEY},
        {
            "X-Internal-Api-Key": JOB_RECOMMENDATION_KEY,
            "X-Internal-Service": "job-search-service",
        },
        {
            "X-Internal-Api-Key": CANDIDATE_KEY,
            "X-Internal-Service": "application-service",
        },
    ],
)
def test_recommend_candidates_requires_exact_direction_scoped_key(
    headers: dict[str, str],
) -> None:
    repository = StubRecommendationRepository([])

    with make_client(repository) as client:
        response = client.post(
            "/recommend/candidates",
            headers=headers,
            json=request_body(),
        )

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_INTERNAL_CALLER"
    assert repository.calls == []


@pytest.mark.parametrize(
    "payload",
    [
        request_body(eligible_candidates=[]),
        request_body(
            eligible_candidates=[
                eligibility(CANDIDATE_A, CV_A),
                eligibility(CANDIDATE_A, CV_B),
            ]
        ),
        request_body(
            eligible_candidates=[
                eligibility(CANDIDATE_A, CV_A),
                eligibility(CANDIDATE_B, CV_A),
            ]
        ),
        request_body(
            eligible_candidates=[
                eligibility(CANDIDATE_B, CV_B),
                eligibility(CANDIDATE_A, CV_A),
            ]
        ),
        request_body(
            eligible_candidates=[eligibility(CANDIDATE_A, CV_A, discovery_version=0)]
        ),
        {key: value for key, value in request_body().items() if key != "job_version"},
        request_body(job_version=0),
        request_body(job_version=2_147_483_648),
        request_body(job_version="7"),
        request_body(job_version=True),
        request_body(limit=0),
        request_body(limit="10"),
        request_body(extra=True),
    ],
)
def test_recommend_candidates_rejects_invalid_or_ambiguous_scope(
    payload: dict[str, object],
) -> None:
    repository = StubRecommendationRepository([])

    with make_client(repository) as client:
        response = client.post(
            "/recommend/candidates",
            headers=AUTH_HEADERS,
            json=payload,
        )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert repository.calls == []


def test_candidate_cursor_is_bound_to_job_consent_and_profile_versions() -> None:
    first_page = RecommendationPage(
        (RecommendationDistanceItem(CANDIDATE_A, 0.25),),
        SOURCE_FINGERPRINT,
        RecommendationBoundary(0.25, CANDIDATE_A, page=1),
        None,
    )
    repository = StubRecommendationRepository([first_page])

    with make_client(repository) as client:
        first = client.post(
            "/recommend/candidates",
            headers=AUTH_HEADERS,
            json=request_body(limit=1),
        )
        changed_job = client.post(
            "/recommend/candidates",
            headers=AUTH_HEADERS,
            json=request_body(
                limit=1,
                cursor=first.json()["data"]["next_cursor"],
                job_version=JOB_VERSION + 1,
            ),
        )
        changed_scope = request_body(
            limit=1,
            cursor=first.json()["data"]["next_cursor"],
            eligible_candidates=[
                eligibility(CANDIDATE_A, CV_A, profile_version=2),
                eligibility(CANDIDATE_B, CV_B, discovery_version=2),
            ],
        )
        stale = client.post(
            "/recommend/candidates",
            headers=AUTH_HEADERS,
            json=changed_scope,
        )

    assert first.status_code == 200
    assert changed_job.status_code == 409
    assert changed_job.json()["code"] == "RECOMMENDATION_CURSOR_STALE"
    assert stale.status_code == 409
    assert stale.json()["code"] == "RECOMMENDATION_CURSOR_STALE"
    assert len(repository.calls) == 1


def test_repository_result_outside_consent_scope_fails_closed() -> None:
    repository = StubRecommendationRepository(
        [
            RecommendationPage(
                (RecommendationDistanceItem(CANDIDATE_C, 0.1),),
                SOURCE_FINGERPRINT,
                None,
                None,
            )
        ]
    )

    with make_client(repository) as client:
        response = client.post(
            "/recommend/candidates",
            headers=AUTH_HEADERS,
            json=request_body(),
        )

    assert response.status_code == 503
    assert response.json()["code"] == "AI_SERVICE_UNAVAILABLE"
    assert "candidate" not in response.text.lower()


def test_openapi_exposes_candidate_route_with_distinct_scoped_scheme() -> None:
    repository = StubRecommendationRepository([])

    with make_client(repository) as client:
        schema = client.get("/openapi.json").json()

    operation = schema["paths"]["/recommend/candidates"]["post"]
    assert operation["security"] == [{"JobSearchCandidateInternalApiKey": []}]
    assert set(operation["responses"]) == {"200", "401", "409", "422", "503"}


def make_client(repository: StubRecommendationRepository) -> TestClient:
    return TestClient(
        create_app(
            settings=Settings(
                database_url="postgresql://unused-for-unit-tests",
                internal_api_key=MATCH_KEY,
                internal_api_key_job_search=JOB_RECOMMENDATION_KEY,
                internal_api_key_job_search_candidates=CANDIDATE_KEY,
            ),
            match_repository=UnusedMatchRepository(),
            recommendation_repository=repository,
        )
    )
