"""Public Candidate chat HTTP contract and privacy headers."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.chat_service import ChatResult
from app.config import Settings
from app.database import MatchResult
from app.errors import ServiceError
from app.main import create_app
from app.user_auth import AuthenticatedUser, AuthKeyUnavailable, InvalidAccessToken

USER_ID = UUID("10000000-0000-4000-8000-000000000001")
SESSION_ID = UUID("20000000-0000-4000-8000-000000000001")
TOKEN = "header.payload.signature"


class UnusedRepository:
    def calculate(self, *_: object) -> MatchResult:
        raise AssertionError("match repository must not be called")


@dataclass
class StubAuthenticator:
    role: str = "CANDIDATE"
    error: Exception | None = None
    tokens: list[str] = field(default_factory=list)

    def authenticate(self, token: str) -> AuthenticatedUser:
        self.tokens.append(token)
        if self.error is not None:
            raise self.error
        return AuthenticatedUser(user_id=USER_ID, role=self.role)


@dataclass
class StubChatService:
    error: ServiceError | None = None
    calls: list[tuple[UUID, UUID, str]] = field(default_factory=list)

    def reply(self, user_id: UUID, session_id: UUID, message: str) -> ChatResult:
        self.calls.append((user_id, session_id, message))
        if self.error is not None:
            raise self.error
        return ChatResult(answer="Bạn mở mục Đơn ứng tuyển để theo dõi.")


def test_chat_returns_private_envelope_and_uses_jwt_subject() -> None:
    authenticator = StubAuthenticator()
    service = StubChatService()

    with make_client(authenticator, service) as client:
        response = client.post(
            "/chat",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"session_id": str(SESSION_ID), "message": "  Theo dõi đơn?  "},
        )

    assert response.status_code == 200
    assert response.json() == {
        "data": {
            "session_id": str(SESSION_ID),
            "answer": "Bạn mở mục Đơn ứng tuyển để theo dõi.",
        },
        "meta": None,
    }
    assert_private_headers(response.headers)
    assert authenticator.tokens == [TOKEN]
    assert service.calls == [(USER_ID, SESSION_ID, "Theo dõi đơn?")]


@pytest.mark.parametrize(
    ("authenticator", "expected_status", "expected_code"),
    [
        (
            StubAuthenticator(error=InvalidAccessToken("invalid")),
            401,
            "INVALID_ACCESS_TOKEN",
        ),
        (
            StubAuthenticator(error=AuthKeyUnavailable("down")),
            503,
            "AUTH_KEY_UNAVAILABLE",
        ),
        (StubAuthenticator(role="RECRUITER"), 403, "CHAT_ACCESS_FORBIDDEN"),
    ],
)
def test_chat_maps_auth_failures_without_leaking_details(
    authenticator: StubAuthenticator,
    expected_status: int,
    expected_code: str,
) -> None:
    service = StubChatService()

    with make_client(authenticator, service) as client:
        response = client.post(
            "/chat",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"session_id": str(SESSION_ID), "message": "question"},
        )

    assert response.status_code == expected_status
    assert response.json()["code"] == expected_code
    assert "down" not in response.text
    assert_private_headers(response.headers)
    assert service.calls == []


def test_chat_rejects_missing_bearer_token() -> None:
    authenticator = StubAuthenticator()

    with make_client(authenticator, StubChatService()) as client:
        response = client.post(
            "/chat",
            json={"session_id": str(SESSION_ID), "message": "question"},
        )

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"
    assert_private_headers(response.headers)
    assert authenticator.tokens == []


@pytest.mark.parametrize(
    "payload",
    [
        {"session_id": "not-a-uuid", "message": "question"},
        {"session_id": "20000000-0000-1000-8000-000000000001", "message": "question"},
        {"session_id": str(SESSION_ID), "message": "   "},
        {"session_id": str(SESSION_ID), "message": "unsafe\x00message"},
        {"session_id": str(SESSION_ID), "message": "x", "user_id": str(USER_ID)},
    ],
)
def test_chat_validation_is_strict(payload: dict[str, object]) -> None:
    service = StubChatService()

    with make_client(StubAuthenticator(), service) as client:
        response = client.post(
            "/chat",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json=payload,
        )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert_private_headers(response.headers)
    assert service.calls == []


def test_chat_rate_error_carries_retry_after_and_private_headers() -> None:
    service = StubChatService(
        error=ServiceError(
            status_code=429,
            code="CHAT_RATE_LIMITED",
            message="Too many chat requests; retry later",
            details={"retryAfterSeconds": 12},
            headers={"Retry-After": "12"},
        )
    )

    with make_client(StubAuthenticator(), service) as client:
        response = client.post(
            "/chat",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"session_id": str(SESSION_ID), "message": "question"},
        )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "12"
    assert response.json()["details"] == {"retryAfterSeconds": 12}
    assert_private_headers(response.headers)


def test_disabled_chat_replaces_the_unauthenticated_placeholder() -> None:
    settings = base_settings(chat_enabled=False)
    application = create_app(settings=settings, match_repository=UnusedRepository())

    with TestClient(application) as client:
        response = client.post(
            "/chat",
            json={"session_id": str(SESSION_ID), "message": "question"},
        )

    assert response.status_code == 503
    assert response.json()["code"] == "CHAT_NOT_CONFIGURED"
    assert_private_headers(response.headers)


def test_openapi_documents_bearer_and_exact_chat_responses() -> None:
    with make_client(StubAuthenticator(), StubChatService()) as client:
        schema = client.get("/openapi.json").json()

    assert schema["components"]["securitySchemes"]["ChatBearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
    }
    operation = schema["paths"]["/chat"]["post"]
    assert operation["security"] == [{"ChatBearerAuth": []}]
    assert set(operation["responses"]) == {
        "200",
        "401",
        "403",
        "409",
        "422",
        "429",
        "503",
    }


def test_lifespan_closes_only_resources_created_by_the_application(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    closed: list[str] = []

    class OwnedAuthenticator:
        def __init__(self, **_: object) -> None:
            pass

        def close(self) -> None:
            closed.append("auth")

    class OwnedStore:
        @classmethod
        def from_url(cls, *_: object, **__: object) -> OwnedStore:
            return cls()

        def close(self) -> None:
            closed.append("redis")

    class OwnedProvider:
        def __init__(self, **_: object) -> None:
            pass

        def close(self) -> None:
            closed.append("provider")

    monkeypatch.setattr(main_module, "JwksJwtAuthenticator", OwnedAuthenticator)
    monkeypatch.setattr(main_module, "RedisChatStore", OwnedStore)
    monkeypatch.setattr(main_module, "AnthropicChatProvider", OwnedProvider)
    application = main_module.create_app(
        settings=base_settings(chat_enabled=True),
        match_repository=UnusedRepository(),
    )

    with TestClient(application):
        assert application.state.chat_service is not None
        assert application.state.chat_authenticator is not None

    assert closed == ["provider", "redis", "auth"]
    assert application.state.chat_service is None
    assert application.state.chat_authenticator is None


def make_client(
    authenticator: StubAuthenticator,
    service: StubChatService,
) -> TestClient:
    application = create_app(
        settings=base_settings(chat_enabled=True),
        match_repository=UnusedRepository(),
        chat_service=service,  # type: ignore[arg-type]
        chat_authenticator=authenticator,  # type: ignore[arg-type]
    )
    return TestClient(application)


def base_settings(*, chat_enabled: bool) -> Settings:
    return Settings(
        database_url="postgresql://unused-for-unit-tests",
        internal_api_key="shared-internal-key",
        internal_api_key_job_search="job-search-scoped-internal-key-000001",
        internal_api_key_job_search_candidates=(
            "job-search-candidate-scoped-key-000001"
        ),
        chat_enabled=chat_enabled,
        redis_url="redis://:unit-test-password@redis:6379/15",
        chat_redis_key_secret="chat-redis-key-secret-000000000001",
        anthropic_api_key="anthropic-test-key-0000000000000001",
        jwt_issuer="https://auth.recruitment.local",
        jwt_audience="recruitment-api",
        jwt_jwks_uri="http://auth-service:8080/auth/.well-known/jwks.json",
        jwt_jwks_allowed_hosts=("auth-service",),
        jwt_allow_insecure_jwks=True,
    )


def assert_private_headers(headers: object) -> None:
    assert headers["cache-control"] == "private, no-store"  # type: ignore[index]
    assert headers["pragma"] == "no-cache"  # type: ignore[index]
    assert headers["vary"] == "Authorization"  # type: ignore[index]
