"""HTTP contract tests for the AI Service."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from app.config import Settings
from app.database import MatchResult, MatchStoreUnavailable
from app.main import create_app

API_KEY = "shared-internal-key"
SCOPED_JOB_KEY = "job-search-scoped-internal-key-000001"
SCOPED_CANDIDATE_KEY = "job-search-candidate-scoped-key-000001"
CV_ID = UUID("10000000-0000-0000-0000-000000000001")
JOB_ID = UUID("20000000-0000-0000-0000-000000000001")
MATCH_PAYLOAD = {"cv_id": str(CV_ID), "job_id": str(JOB_ID)}
AUTH_HEADERS = {"X-Internal-Api-Key": API_KEY}


@dataclass
class StubMatchRepository:
    result: MatchResult | None = None
    error: Exception | None = None
    calls: list[tuple[UUID, UUID]] = field(default_factory=list)

    def calculate(self, cv_id: UUID, job_id: UUID) -> MatchResult:
        self.calls.append((cv_id, job_id))
        if self.error is not None:
            raise self.error
        if self.result is None:
            raise AssertionError("A stub result must be configured")
        return self.result


@dataclass
class StubReadinessProbe:
    error: Exception | None = None
    calls: int = 0

    def check(self) -> None:
        self.calls += 1
        if self.error is not None:
            raise self.error


def test_match_returns_shared_envelope_and_echoes_identifiers() -> None:
    repository = StubMatchRepository(result=MatchResult(0.85456, None))

    with make_client(repository) as client:
        response = client.post(
            "/match",
            headers=AUTH_HEADERS,
            json=MATCH_PAYLOAD,
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {
        "data": {
            "cv_id": str(CV_ID),
            "job_id": str(JOB_ID),
            "score": 0.85456,
            "reason": None,
        },
        "meta": None,
    }
    assert repository.calls == [(CV_ID, JOB_ID)]


@pytest.mark.parametrize(
    "reason",
    [
        "CV_EMBEDDING_NOT_FOUND",
        "JOB_EMBEDDING_NOT_FOUND",
        "CV_AND_JOB_EMBEDDINGS_NOT_FOUND",
        "EMBEDDING_MODEL_MISMATCH",
    ],
)
def test_match_returns_not_ready_reason_in_success_envelope(reason: str) -> None:
    repository = StubMatchRepository(
        result=MatchResult(score=None, reason=f"  {reason}  ")
    )

    with make_client(repository) as client:
        response = client.post(
            "/match",
            headers=AUTH_HEADERS,
            json=MATCH_PAYLOAD,
        )

    assert response.status_code == 200
    assert response.json() == {
        "data": {
            "cv_id": str(CV_ID),
            "job_id": str(JOB_ID),
            "score": None,
            "reason": reason,
        },
        "meta": None,
    }


@pytest.mark.parametrize(
    "headers",
    [{}, {"X-Internal-Api-Key": "wrong-key"}],
    ids=["missing", "wrong"],
)
def test_match_rejects_missing_or_wrong_internal_key(
    headers: dict[str, str],
) -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))

    with make_client(repository) as client:
        response = client.post("/match", headers=headers, json=MATCH_PAYLOAD)

    assert response.status_code == 401
    assert response.json() == {
        "code": "INVALID_INTERNAL_API_KEY",
        "message": "A valid internal API key is required",
        "details": None,
    }
    assert repository.calls == []


def test_match_rejects_wrong_key_when_configured_key_is_unicode() -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))

    with make_client(
        repository,
        internal_api_key="khóa-nội-bộ",
    ) as client:
        response = client.post(
            "/match",
            headers={"X-Internal-Api-Key": "wrong-key"},
            json=MATCH_PAYLOAD,
        )

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_INTERNAL_API_KEY"
    assert repository.calls == []


@pytest.mark.parametrize(
    ("payload", "field_name", "error_type"),
    [
        (
            {"cv_id": "not-a-uuid", "job_id": str(JOB_ID)},
            "body.cv_id",
            "uuid_parsing",
        ),
        ({"cv_id": str(CV_ID)}, "body.job_id", "missing"),
        (
            {**MATCH_PAYLOAD, "unexpected": True},
            "body.unexpected",
            "extra_forbidden",
        ),
    ],
)
def test_match_validation_uses_shared_error_envelope(
    payload: dict[str, object],
    field_name: str,
    error_type: str,
) -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))

    with make_client(repository) as client:
        response = client.post(
            "/match",
            headers=AUTH_HEADERS,
            json=payload,
        )

    assert_validation_error(response)
    errors = response.json()["details"]["errors"]
    assert any(
        error["field"] == field_name and error["type"] == error_type for error in errors
    )
    assert repository.calls == []


def test_match_malformed_json_uses_shared_validation_envelope() -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))
    headers = {**AUTH_HEADERS, "Content-Type": "application/json"}

    with make_client(repository) as client:
        response = client.post(
            "/match",
            headers=headers,
            content='{"cv_id":',
        )

    assert_validation_error(response)
    errors = response.json()["details"]["errors"]
    assert any(error["type"] == "json_invalid" for error in errors)
    assert repository.calls == []


def test_match_maps_vector_store_failure_to_service_unavailable() -> None:
    repository = StubMatchRepository(
        error=MatchStoreUnavailable("database is unavailable")
    )

    with make_client(repository) as client:
        response = client.post(
            "/match",
            headers=AUTH_HEADERS,
            json=MATCH_PAYLOAD,
        )

    assert_service_unavailable(response)
    assert repository.calls == [(CV_ID, JOB_ID)]


@pytest.mark.parametrize(
    "result",
    [
        MatchResult(float("nan"), None),
        MatchResult(float("inf"), None),
        MatchResult(float("-inf"), None),
        MatchResult(-0.0001, None),
        MatchResult(1.0001, None),
        MatchResult(0.5, "STALE_EMBEDDING"),
        MatchResult(None, None),
        MatchResult(None, "   "),
    ],
    ids=[
        "nan",
        "positive-infinity",
        "negative-infinity",
        "below-zero",
        "above-one",
        "score-and-reason",
        "neither-score-nor-reason",
        "blank-reason",
    ],
)
def test_match_rejects_invalid_repository_result(result: MatchResult) -> None:
    repository = StubMatchRepository(result=result)

    with make_client(repository) as client:
        response = client.post(
            "/match",
            headers=AUTH_HEADERS,
            json=MATCH_PAYLOAD,
        )

    assert_service_unavailable(response)


def test_health_and_chat_placeholder_remain_available() -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))

    with make_client(repository) as client:
        health = client.get("/health")
        chat = client.post(
            "/chat",
            json={"session_id": "session-1", "message": "Hello"},
        )

    assert health.status_code == 200
    assert health.json() == {"service": "ai-service", "status": "UP"}
    assert chat.status_code == 200
    assert chat.json() == {
        "message": "AI chat service is ready for provider integration."
    }
    assert repository.calls == []


def test_ready_returns_ready_when_vector_store_probe_succeeds() -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))
    readiness_probe = StubReadinessProbe()

    with make_client(repository, readiness_probe=readiness_probe) as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"service": "ai-service", "status": "READY"}
    assert readiness_probe.calls == 1
    assert repository.calls == []


def test_ready_maps_vector_store_failure_to_service_unavailable() -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))
    readiness_probe = StubReadinessProbe(
        error=MatchStoreUnavailable("database is unavailable")
    )

    with make_client(repository, readiness_probe=readiness_probe) as client:
        response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {
        "code": "AI_SERVICE_UNAVAILABLE",
        "message": "AI vector store is not ready",
        "details": None,
    }
    assert readiness_probe.calls == 1
    assert repository.calls == []


def test_openapi_documents_internal_auth_and_match_responses() -> None:
    repository = StubMatchRepository(result=MatchResult(0.5, None))

    with make_client(repository) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    security_scheme = schema["components"]["securitySchemes"]["InternalApiKey"]
    assert security_scheme == {
        "type": "apiKey",
        "in": "header",
        "name": "X-Internal-Api-Key",
    }

    match_operation = schema["paths"]["/match"]["post"]
    assert match_operation["security"] == [{"InternalApiKey": []}]
    assert set(match_operation["responses"]) == {"200", "401", "422", "503"}
    assert_response_model(match_operation, "200", "MatchResponse")
    for status_code in ("401", "422", "503"):
        assert_response_model(match_operation, status_code, "ErrorResponse")


def make_client(
    repository: StubMatchRepository,
    *,
    readiness_probe: StubReadinessProbe | None = None,
    internal_api_key: str = API_KEY,
) -> TestClient:
    settings = Settings(
        database_url="postgresql://unused-for-unit-tests",
        internal_api_key=internal_api_key,
        internal_api_key_job_search=SCOPED_JOB_KEY,
        internal_api_key_job_search_candidates=SCOPED_CANDIDATE_KEY,
    )
    return TestClient(
        create_app(
            settings=settings,
            match_repository=repository,
            readiness_probe=readiness_probe,
        )
    )


def assert_validation_error(response: Response) -> None:
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["message"] == "Request validation failed"
    assert isinstance(body["details"]["errors"], list)
    assert body["details"]["errors"]


def assert_service_unavailable(response: Response) -> None:
    assert response.status_code == 503
    assert response.json() == {
        "code": "AI_SERVICE_UNAVAILABLE",
        "message": "AI match scoring is temporarily unavailable",
        "details": None,
    }


def assert_response_model(
    operation: dict[str, object],
    status_code: str,
    model_name: str,
) -> None:
    responses = operation["responses"]
    assert isinstance(responses, dict)
    response = responses[status_code]
    assert isinstance(response, dict)
    content = response["content"]
    assert isinstance(content, dict)
    json_content = content["application/json"]
    assert isinstance(json_content, dict)
    schema = json_content["schema"]
    assert isinstance(schema, dict)
    assert schema["$ref"] == f"#/components/schemas/{model_name}"
