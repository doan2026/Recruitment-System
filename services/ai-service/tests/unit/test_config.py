"""Unit tests for fail-fast AI Service configuration."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import MatchResult
from app.main import create_app

SCOPED_KEY = "job-search-scoped-internal-key-000001"
CANDIDATE_SCOPED_KEY = "job-search-candidate-scoped-key-000001"
DATABASE_URL = "postgresql://postgres/recruitment"


class UnusedRepository:
    def calculate(self, *_: object) -> MatchResult:
        raise AssertionError("The repository must not be used during startup")


def test_settings_validate_accepts_required_values() -> None:
    settings = Settings(
        database_url="postgresql://postgres:secret@postgres/recruitment",
        internal_api_key="shared-secret",
        internal_api_key_job_search=SCOPED_KEY,
        internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
    )

    settings.validate()


@pytest.mark.parametrize(
    ("settings", "message"),
    [
        (
            Settings(
                database_url="",
                internal_api_key="shared-secret",
                internal_api_key_job_search=SCOPED_KEY,
                internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
            ),
            "DATABASE_URL must be configured",
        ),
        (
            Settings(
                database_url=DATABASE_URL,
                internal_api_key="",
                internal_api_key_job_search=SCOPED_KEY,
                internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
            ),
            "INTERNAL_API_KEY must be configured",
        ),
        (
            Settings(
                database_url=DATABASE_URL,
                internal_api_key="shared-secret",
                internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
            ),
            "INTERNAL_API_KEY_JOB_SEARCH must be configured",
        ),
        (
            Settings(
                database_url=DATABASE_URL,
                internal_api_key="shared-secret",
                internal_api_key_job_search=SCOPED_KEY,
            ),
            "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES is invalid",
        ),
    ],
)
def test_settings_validate_rejects_missing_required_values(
    settings: Settings,
    message: str,
) -> None:
    with pytest.raises(RuntimeError, match=message):
        settings.validate()


def test_settings_from_environment_strips_values_and_reads_timeouts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "  postgresql://postgres:secret@postgres/recruitment  ",
    )
    monkeypatch.setenv("INTERNAL_API_KEY", "  shared-secret  ")
    monkeypatch.setenv("INTERNAL_API_KEY_JOB_SEARCH", SCOPED_KEY)
    monkeypatch.setenv(
        "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES",
        CANDIDATE_SCOPED_KEY,
    )
    monkeypatch.setenv("DATABASE_CONNECT_TIMEOUT_SECONDS", "7")
    monkeypatch.setenv("DATABASE_STATEMENT_TIMEOUT_MS", "3500")

    settings = Settings.from_environment()

    assert settings == Settings(
        database_url="postgresql://postgres:secret@postgres/recruitment",
        internal_api_key="shared-secret",
        internal_api_key_job_search=SCOPED_KEY,
        internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
        database_connect_timeout_seconds=7,
        database_statement_timeout_ms=3500,
    )


def test_settings_from_environment_uses_timeout_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("INTERNAL_API_KEY", "shared-secret")
    monkeypatch.delenv("DATABASE_CONNECT_TIMEOUT_SECONDS", raising=False)
    monkeypatch.setenv("INTERNAL_API_KEY_JOB_SEARCH", SCOPED_KEY)
    monkeypatch.setenv(
        "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES",
        CANDIDATE_SCOPED_KEY,
    )
    monkeypatch.delenv("DATABASE_STATEMENT_TIMEOUT_MS", raising=False)

    settings = Settings.from_environment()

    assert settings.database_connect_timeout_seconds == 2
    assert settings.database_statement_timeout_ms == 2_000


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("DATABASE_CONNECT_TIMEOUT_SECONDS", "not-an-integer"),
        ("DATABASE_CONNECT_TIMEOUT_SECONDS", "0"),
        ("DATABASE_CONNECT_TIMEOUT_SECONDS", "-1"),
        ("DATABASE_STATEMENT_TIMEOUT_MS", "not-an-integer"),
        ("DATABASE_STATEMENT_TIMEOUT_MS", "0"),
        ("DATABASE_STATEMENT_TIMEOUT_MS", "-1"),
    ],
)
def test_settings_rejects_invalid_positive_integer_environment_values(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
) -> None:
    monkeypatch.setenv("DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("INTERNAL_API_KEY", "shared-secret")
    monkeypatch.delenv("DATABASE_CONNECT_TIMEOUT_SECONDS", raising=False)
    monkeypatch.setenv("INTERNAL_API_KEY_JOB_SEARCH", SCOPED_KEY)
    monkeypatch.setenv(
        "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES",
        CANDIDATE_SCOPED_KEY,
    )
    monkeypatch.delenv("DATABASE_STATEMENT_TIMEOUT_MS", raising=False)
    monkeypatch.setenv(name, value)

    with pytest.raises(
        RuntimeError,
        match=rf"{name} must be a positive integer",
    ):
        Settings.from_environment()


@pytest.mark.parametrize(
    "scoped_key",
    [
        "too-short",
        "a" * 513,
        " job-search-scoped-internal-key-00001",
        "job-search-scoped-internal-key-00001\n",
        "job-search-scoped-internal-key-khóa",
    ],
)
def test_settings_rejects_invalid_job_search_scoped_key(
    scoped_key: str,
) -> None:
    settings = Settings(
        database_url=DATABASE_URL,
        internal_api_key="shared-secret",
        internal_api_key_job_search=scoped_key,
        internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
    )

    with pytest.raises(
        RuntimeError,
        match="INTERNAL_API_KEY_JOB_SEARCH is invalid",
    ):
        settings.validate()


@pytest.mark.parametrize(
    ("job_key", "candidate_key"),
    [
        (
            "replace-with-job-search-scoped-key-000001",
            CANDIDATE_SCOPED_KEY,
        ),
        (
            SCOPED_KEY,
            "candidate-REPLACE-WITH-scoped-key-000001",
        ),
    ],
)
def test_settings_rejects_scoped_key_placeholders_case_insensitively(
    job_key: str,
    candidate_key: str,
) -> None:
    settings = Settings(
        database_url=DATABASE_URL,
        internal_api_key="shared-secret",
        internal_api_key_job_search=job_key,
        internal_api_key_job_search_candidates=candidate_key,
    )

    with pytest.raises(RuntimeError, match="INTERNAL_API_KEY_JOB_SEARCH"):
        settings.validate()


def test_settings_rejects_reusing_match_key_for_job_recommendations() -> None:
    settings = Settings(
        database_url=DATABASE_URL,
        internal_api_key=SCOPED_KEY,
        internal_api_key_job_search=SCOPED_KEY,
        internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
    )

    with pytest.raises(RuntimeError, match="must differ from INTERNAL_API_KEY"):
        settings.validate()


def test_application_lifespan_validates_configuration() -> None:
    settings = Settings(
        database_url="",
        internal_api_key="shared-secret",
        internal_api_key_job_search=SCOPED_KEY,
        internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
    )
    application = create_app(
        settings=settings,
        match_repository=UnusedRepository(),
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL must be configured"):
        with TestClient(application):
            pass


def test_chat_configuration_is_conditionally_required_and_valid() -> None:
    disabled = Settings(
        database_url=DATABASE_URL,
        internal_api_key="shared-secret",
        internal_api_key_job_search=SCOPED_KEY,
        internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
    )
    disabled.validate()

    enabled = Settings(
        database_url=DATABASE_URL,
        internal_api_key="shared-secret",
        internal_api_key_job_search=SCOPED_KEY,
        internal_api_key_job_search_candidates=CANDIDATE_SCOPED_KEY,
        chat_enabled=True,
        redis_url="redis://:secret@redis:6379/15",
        chat_redis_key_secret="chat-redis-key-secret-000000000001",
        anthropic_api_key="anthropic-api-key-00000000000000001",
        jwt_issuer="https://auth.recruitment.local",
        jwt_audience="recruitment-api",
        jwt_jwks_uri="http://auth-service:8080/auth/.well-known/jwks.json",
        jwt_jwks_allowed_hosts=("auth-service",),
        jwt_allow_insecure_jwks=True,
    )
    enabled.validate()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"redis_url": "redis://redis:6379"}, "REDIS_URL"),
        ({"chat_redis_key_secret": "short"}, "CHAT_REDIS_KEY_SECRET"),
        (
            {"anthropic_api_key": "replace-with-provider-key-00000000"},
            "ANTHROPIC_API_KEY",
        ),
        ({"anthropic_model": "INVALID MODEL"}, "ANTHROPIC_MODEL"),
        ({"jwt_issuer": ""}, "JWT_ISSUER"),
        ({"jwt_jwks_allowed_hosts": ()}, "JWT JWKS"),
        ({"chat_global_rate_limit": 5}, "CHAT_GLOBAL_RATE_LIMIT"),
        ({"chat_session_lock_seconds": 19}, "CHAT_SESSION_LOCK_SECONDS"),
    ],
)
def test_chat_configuration_fails_closed(
    changes: dict[str, object],
    message: str,
) -> None:
    values: dict[str, object] = {
        "database_url": DATABASE_URL,
        "internal_api_key": "shared-secret",
        "internal_api_key_job_search": SCOPED_KEY,
        "internal_api_key_job_search_candidates": CANDIDATE_SCOPED_KEY,
        "chat_enabled": True,
        "redis_url": "redis://:secret@redis:6379/15",
        "chat_redis_key_secret": "chat-redis-key-secret-000000000001",
        "anthropic_api_key": "anthropic-api-key-00000000000000001",
        "jwt_issuer": "https://auth.recruitment.local",
        "jwt_audience": "recruitment-api",
        "jwt_jwks_uri": "http://auth-service:8080/auth/.well-known/jwks.json",
        "jwt_jwks_allowed_hosts": ("auth-service",),
        "jwt_allow_insecure_jwks": True,
    }
    values.update(changes)

    with pytest.raises(RuntimeError, match=message):
        Settings(**values).validate()  # type: ignore[arg-type]
