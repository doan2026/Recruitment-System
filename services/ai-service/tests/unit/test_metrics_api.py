"""HTTP contract for the guarded metrics surface."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import MatchResult
from app.main import create_app

MATCH_KEY = "legacy-match-key"
SCOPED_KEY = "job-search-scoped-internal-key-000001"
CANDIDATE_KEY = "job-search-candidate-scoped-key-000001"


class UnusedMatchRepository:
    def calculate(self, *_: object) -> MatchResult:
        raise AssertionError("match repository must not be called")


class UnusedRecommendationRepository:
    def recommend_jobs(self, *_: object, **__: object) -> object:
        raise AssertionError("recommendation repository must not be called")

    def recommend_candidates(self, *_: object, **__: object) -> object:
        raise AssertionError("recommendation repository must not be called")


def make_client() -> TestClient:
    return TestClient(
        create_app(
            settings=Settings(
                database_url="postgresql://unused-for-unit-tests",
                internal_api_key=MATCH_KEY,
                internal_api_key_job_search=SCOPED_KEY,
                internal_api_key_job_search_candidates=CANDIDATE_KEY,
            ),
            match_repository=UnusedMatchRepository(),
            recommendation_repository=UnusedRecommendationRepository(),
        )
    )


def test_metrics_require_the_internal_credential() -> None:
    with make_client() as client:
        anonymous = client.get("/metrics")
        wrong_key = client.get("/metrics", headers={"X-Internal-Api-Key": "wrong"})

    # Operational detail is not public.
    assert anonymous.status_code == 401
    assert wrong_key.status_code == 401


def test_metrics_expose_prometheus_exposition_to_an_authorised_scrape() -> None:
    with make_client() as client:
        client.get("/health")
        response = client.get("/metrics", headers={"X-Internal-Api-Key": MATCH_KEY})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["cache-control"] == "no-store"
    assert "# TYPE ai_http_requests_total counter" in response.text
    assert "# TYPE ai_http_request_duration_seconds histogram" in response.text


def test_every_served_request_is_counted_including_rejections() -> None:
    with make_client() as client:
        client.get("/health")
        client.get("/health")
        client.get("/metrics")  # unauthorised, still an availability event

        response = client.get("/metrics", headers={"X-Internal-Api-Key": MATCH_KEY})

    assert 'route="/health",status="2xx"} 2' in response.text
    assert 'route="/metrics",status="4xx"} 1' in response.text


def test_an_unknown_path_is_counted_without_creating_a_new_series() -> None:
    with make_client() as client:
        client.get("/definitely-not-a-route")
        response = client.get("/metrics", headers={"X-Internal-Api-Key": MATCH_KEY})

    assert 'route="other"' in response.text
    assert "definitely-not-a-route" not in response.text


def test_latency_is_recorded_for_a_served_route() -> None:
    with make_client() as client:
        client.get("/health")
        response = client.get("/metrics", headers={"X-Internal-Api-Key": MATCH_KEY})

    assert 'ai_http_request_duration_seconds_count{route="/health"} 1' in (
        response.text
    )
