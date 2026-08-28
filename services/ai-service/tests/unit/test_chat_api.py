"""Public Candidate chat HTTP contract and privacy headers."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import BoundedSemaphore, Event, Timer, current_thread
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.chat_service import ChatResult
from app.config import Settings
from app.database import MatchResult
from app.errors import ServiceError
from app.main import CandidateChatContext, create_app
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
    calls: list[tuple[UUID, UUID, str, str | None]] = field(default_factory=list)
    thread_names: list[str] = field(default_factory=list)

    def reply(
        self,
        user_id: UUID,
        session_id: UUID,
        message: str,
        *,
        access_token: str | None = None,
    ) -> ChatResult:
        self.calls.append((user_id, session_id, message, access_token))
        self.thread_names.append(current_thread().name)
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
    assert service.calls == [(USER_ID, SESSION_ID, "Theo dõi đơn?", TOKEN)]
    assert len(service.thread_names) == 1
    assert service.thread_names[0].startswith("candidate-chat")


def test_candidate_chat_context_redacts_bearer_from_repr() -> None:
    context = CandidateChatContext(user_id=USER_ID, access_token=TOKEN)

    assert context.user_id == USER_ID
    assert context.access_token == TOKEN
    assert TOKEN not in repr(context)


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


def test_chat_admission_rejects_excess_work_without_queueing() -> None:
    service = StubChatService()

    with make_client(StubAuthenticator(), service) as client:
        admission = client.app.state.chat_admission
        acquired = 0
        while admission.acquire(blocking=False):
            acquired += 1
        assert acquired == 8
        try:
            response = client.post(
                "/chat",
                headers={"Authorization": f"Bearer {TOKEN}"},
                json={"session_id": str(SESSION_ID), "message": "question"},
            )
        finally:
            for _ in range(acquired):
                admission.release()

    assert response.status_code == 503
    assert response.json()["code"] == "CHAT_BUSY"
    assert response.headers["retry-after"] == "1"
    assert_private_headers(response.headers)
    assert service.calls == []


@pytest.mark.parametrize("state", ["success", "error", "cancelled"])
def test_chat_worker_callback_consumes_terminal_state_and_releases_once(
    state: str,
) -> None:
    async def scenario() -> None:
        admission = BoundedSemaphore(1)
        assert admission.acquire(blocking=False) is True
        worker: asyncio.Future[ChatResult] = asyncio.get_running_loop().create_future()
        if state == "success":
            worker.set_result(ChatResult(answer="done"))
        elif state == "error":
            worker.set_exception(RuntimeError("private worker failure"))
        else:
            worker.cancel()

        main_module._finish_chat_worker(worker, admission)

        assert admission.acquire(blocking=False) is True
        assert admission.acquire(blocking=False) is False
        admission.release()

    asyncio.run(scenario())


def test_chat_executor_shutdown_does_not_block_the_event_loop() -> None:
    blocker = Event()
    started = Event()
    executor = ThreadPoolExecutor(max_workers=1)

    def blocked_worker() -> None:
        started.set()
        blocker.wait()

    executor.submit(blocked_worker)
    assert started.wait(timeout=1)

    async def scenario() -> None:
        failsafe = Timer(0.5, blocker.set)
        failsafe.start()
        started_at = asyncio.get_running_loop().time()
        try:
            shutdown = asyncio.create_task(
                main_module._shutdown_chat_executor(executor)
            )
            await asyncio.sleep(0.02)
            assert asyncio.get_running_loop().time() - started_at < 0.2
            blocker.set()
            await shutdown
        finally:
            blocker.set()
            failsafe.cancel()

    asyncio.run(scenario())


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
    original_shutdown = main_module._shutdown_chat_executor

    async def tracked_shutdown(executor: ThreadPoolExecutor) -> None:
        await original_shutdown(executor)
        closed.append("executor")

    monkeypatch.setattr(main_module, "_shutdown_chat_executor", tracked_shutdown)

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

    class OwnedRecommendationClient:
        def __init__(self, **_: object) -> None:
            pass

        def close(self) -> None:
            closed.append("job")

    monkeypatch.setattr(main_module, "JwksJwtAuthenticator", OwnedAuthenticator)
    monkeypatch.setattr(main_module, "RedisChatStore", OwnedStore)
    monkeypatch.setattr(main_module, "AnthropicChatProvider", OwnedProvider)
    monkeypatch.setattr(
        main_module,
        "HttpCandidateJobRecommendationClient",
        OwnedRecommendationClient,
    )
    application = main_module.create_app(
        settings=base_settings(
            chat_enabled=True,
            chat_recommendation_tool_enabled=True,
            chat_job_recommendation_url=("http://job-search-service:3000/recommended"),
            chat_job_service_allowed_hosts=("job-search-service",),
            chat_job_service_allow_insecure_http=True,
        ),
        match_repository=UnusedRepository(),
    )

    with TestClient(application):
        assert application.state.chat_service is not None
        assert application.state.chat_authenticator is not None

    assert closed == ["executor", "provider", "job", "redis", "auth"]
    assert application.state.chat_service is None
    assert application.state.chat_authenticator is None
    assert application.state.chat_executor is None
    assert application.state.chat_admission is None


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


def base_settings(*, chat_enabled: bool, **changes: object) -> Settings:
    values: dict[str, object] = {
        "database_url": "postgresql://unused-for-unit-tests",
        "internal_api_key": "shared-internal-key",
        "internal_api_key_job_search": ("job-search-scoped-internal-key-000001"),
        "internal_api_key_job_search_candidates": (
            "job-search-candidate-scoped-key-000001"
        ),
        "chat_enabled": chat_enabled,
        "redis_url": "redis://:unit-test-password@redis:6379/15",
        "chat_redis_key_secret": "chat-redis-key-secret-000000000001",
        "anthropic_api_key": "anthropic-test-key-0000000000000001",
        "jwt_issuer": "https://auth.recruitment.local",
        "jwt_audience": "recruitment-api",
        "jwt_jwks_uri": ("http://auth-service:8080/auth/.well-known/jwks.json"),
        "jwt_jwks_allowed_hosts": ("auth-service",),
        "jwt_allow_insecure_jwks": True,
    }
    values.update(changes)
    return Settings(**values)  # type: ignore[arg-type]


def assert_private_headers(headers: object) -> None:
    assert headers["cache-control"] == "private, no-store"  # type: ignore[index]
    assert headers["pragma"] == "no-cache"  # type: ignore[index]
    assert headers["vary"] == "Authorization"  # type: ignore[index]
