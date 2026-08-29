"""HTTP contract for the distributed recommendation limits."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import MatchResult
from app.main import create_app
from app.recommendation import (
    RecommendationDistanceItem,
    RecommendationPage,
)
from app.recommendation_limiter import (
    RateDecision,
    RecommendationLimiterUnavailable,
    RecommendationSurface,
)

MATCH_KEY = "legacy-match-key"
JOB_RECOMMENDATION_KEY = "job-search-scoped-internal-key-000001"
CANDIDATE_KEY = "job-search-candidate-scoped-key-000001"
CV_ID = UUID("10000000-0000-0000-0000-000000000001")
JOB_ID = UUID("20000000-0000-0000-0000-000000000001")
CANDIDATE_A = UUID("30000000-0000-0000-0000-000000000001")
CV_A = UUID("40000000-0000-0000-0000-000000000001")
JOB_VERSION = 7
SOURCE_FINGERPRINT = "d" * 64
JOBS_HEADERS = {
    "X-Internal-Api-Key": JOB_RECOMMENDATION_KEY,
    "X-Internal-Service": "job-search-service",
}
CANDIDATES_HEADERS = {
    "X-Internal-Api-Key": CANDIDATE_KEY,
    "X-Internal-Service": "job-search-service",
}


class UnusedMatchRepository:
    def calculate(self, *_: object) -> MatchResult:
        raise AssertionError("match repository must not be called")


@dataclass
class StubRecommendationRepository:
    calls: int = 0

    def _page(self, item_id: UUID) -> RecommendationPage:
        self.calls += 1
        return RecommendationPage(
            items=(RecommendationDistanceItem(item_id, 0.0),),
            source_fingerprint=SOURCE_FINGERPRINT,
            next_boundary=None,
            reason=None,
        )

    def recommend_jobs(self, *_: object, **__: object) -> RecommendationPage:
        return self._page(JOB_ID)

    def recommend_candidates(self, *_: object, **__: object) -> RecommendationPage:
        return self._page(CANDIDATE_A)


@dataclass
class StubLimiter:
    decisions: list[RateDecision | Exception]
    calls: list[tuple[RecommendationSurface, UUID]] = field(default_factory=list)

    def consume(
        self,
        surface: RecommendationSurface,
        subject_id: UUID,
    ) -> RateDecision:
        self.calls.append((surface, subject_id))
        outcome = self.decisions[min(len(self.calls) - 1, len(self.decisions) - 1)]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _allow() -> RateDecision:
    return RateDecision(allowed=True, retry_after_seconds=0)


def _deny(retry_after_seconds: int = 12) -> RateDecision:
    return RateDecision(
        allowed=False,
        retry_after_seconds=retry_after_seconds,
    )


def _jobs_body() -> dict[str, object]:
    return {"cv_id": str(CV_ID), "limit": 2}


def _candidates_body() -> dict[str, object]:
    return {
        "job_id": str(JOB_ID),
        "job_version": JOB_VERSION,
        "eligible_candidates": [
            {
                "candidate_id": str(CANDIDATE_A),
                "cv_id": str(CV_A),
                "discovery_version": 1,
                "profile_version": 1,
            }
        ],
        "limit": 10,
    }


def make_client(
    repository: StubRecommendationRepository,
    limiter: StubLimiter | None,
) -> TestClient:
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
            recommendation_limiter=limiter,
        )
    )


@pytest.mark.parametrize(
    ("path", "headers", "body", "surface", "subject"),
    [
        (
            "/recommend/jobs",
            JOBS_HEADERS,
            _jobs_body(),
            RecommendationSurface.JOBS,
            CV_ID,
        ),
        (
            "/recommend/candidates",
            CANDIDATES_HEADERS,
            _candidates_body(),
            RecommendationSurface.CANDIDATES,
            JOB_ID,
        ),
    ],
)
def test_allowed_request_is_charged_to_its_surface_and_subject(
    path: str,
    headers: dict[str, str],
    body: dict[str, object],
    surface: RecommendationSurface,
    subject: UUID,
) -> None:
    repository = StubRecommendationRepository()
    limiter = StubLimiter([_allow()])

    with make_client(repository, limiter) as client:
        response = client.post(path, headers=headers, json=body)

    assert response.status_code == 200
    assert limiter.calls == [(surface, subject)]
    assert repository.calls == 1


@pytest.mark.parametrize(
    ("path", "headers", "body"),
    [
        ("/recommend/jobs", JOBS_HEADERS, _jobs_body()),
        ("/recommend/candidates", CANDIDATES_HEADERS, _candidates_body()),
    ],
)
def test_exhausted_budget_returns_429_before_any_store_work(
    path: str,
    headers: dict[str, str],
    body: dict[str, object],
) -> None:
    repository = StubRecommendationRepository()
    limiter = StubLimiter([_deny(retry_after_seconds=12)])

    with make_client(repository, limiter) as client:
        response = client.post(path, headers=headers, json=body)

    assert response.status_code == 429
    assert response.json() == {
        "code": "RECOMMENDATION_RATE_LIMITED",
        "message": "Too many recommendation requests; retry shortly",
        "details": {"retryAfterSeconds": 12},
    }
    assert response.headers["Retry-After"] == "12"
    # The limit is charged before the vector store is touched at all.
    assert repository.calls == 0


@pytest.mark.parametrize(
    ("path", "headers", "body"),
    [
        ("/recommend/jobs", JOBS_HEADERS, _jobs_body()),
        ("/recommend/candidates", CANDIDATES_HEADERS, _candidates_body()),
    ],
)
def test_limiter_outage_fails_closed_without_leaking_details(
    path: str,
    headers: dict[str, str],
    body: dict[str, object],
) -> None:
    repository = StubRecommendationRepository()
    limiter = StubLimiter(
        [RecommendationLimiterUnavailable("redis://secret@host is down")]
    )

    with make_client(repository, limiter) as client:
        response = client.post(path, headers=headers, json=body)

    assert response.status_code == 503
    assert response.json() == {
        "code": "RECOMMENDATION_LIMIT_UNAVAILABLE",
        "message": "Recommendations are temporarily unavailable",
        "details": None,
    }
    assert "secret" not in response.text
    assert repository.calls == 0


@pytest.mark.parametrize(
    ("path", "headers", "body"),
    [
        ("/recommend/jobs", JOBS_HEADERS, _jobs_body()),
        ("/recommend/candidates", CANDIDATES_HEADERS, _candidates_body()),
    ],
)
def test_recommendations_serve_normally_when_no_limiter_is_configured(
    path: str,
    headers: dict[str, str],
    body: dict[str, object],
) -> None:
    repository = StubRecommendationRepository()

    with make_client(repository, None) as client:
        response = client.post(path, headers=headers, json=body)

    assert response.status_code == 200
    assert repository.calls == 1


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/recommend/jobs", _jobs_body()),
        ("/recommend/candidates", _candidates_body()),
    ],
)
def test_unauthenticated_caller_is_rejected_without_spending_budget(
    path: str,
    body: dict[str, object],
) -> None:
    repository = StubRecommendationRepository()
    limiter = StubLimiter([_allow()])

    with make_client(repository, limiter) as client:
        response = client.post(
            path,
            headers={"X-Internal-Api-Key": "wrong-key"},
            json=body,
        )

    assert response.status_code == 401
    # An unauthenticated caller must not be able to drain another subject's
    # budget, so authorization runs before the limit is charged.
    assert limiter.calls == []
    assert repository.calls == 0


def test_one_surface_cannot_spend_the_other_surfaces_budget() -> None:
    repository = StubRecommendationRepository()
    limiter = StubLimiter([_allow(), _allow()])

    with make_client(repository, limiter) as client:
        client.post("/recommend/jobs", headers=JOBS_HEADERS, json=_jobs_body())
        client.post(
            "/recommend/candidates",
            headers=CANDIDATES_HEADERS,
            json=_candidates_body(),
        )

    assert limiter.calls == [
        (RecommendationSurface.JOBS, CV_ID),
        (RecommendationSurface.CANDIDATES, JOB_ID),
    ]


def test_invalid_payload_is_rejected_without_spending_budget() -> None:
    repository = StubRecommendationRepository()
    limiter = StubLimiter([_allow()])

    with make_client(repository, limiter) as client:
        response = client.post(
            "/recommend/jobs",
            headers=JOBS_HEADERS,
            json={"cv_id": "not-a-uuid", "limit": 2},
        )

    assert response.status_code == 422
    assert limiter.calls == []
    assert repository.calls == 0
