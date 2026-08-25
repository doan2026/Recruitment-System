"""Unit tests for fail-fast AI Service configuration."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import MatchResult
from app.main import create_app


class UnusedRepository:
    def calculate(self, *_: object) -> MatchResult:
        raise AssertionError("The repository must not be used during startup")


def test_settings_validate_accepts_required_values() -> None:
    settings = Settings(
        database_url="postgresql://postgres:secret@postgres/recruitment",
        internal_api_key="shared-secret",
    )

    settings.validate()


@pytest.mark.parametrize(
    ("settings", "message"),
    [
        (
            Settings(database_url="", internal_api_key="shared-secret"),
            "DATABASE_URL must be configured",
        ),
        (
            Settings(
                database_url="postgresql://postgres/recruitment",
                internal_api_key="",
            ),
            "INTERNAL_API_KEY must be configured",
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
    monkeypatch.setenv("DATABASE_CONNECT_TIMEOUT_SECONDS", "7")
    monkeypatch.setenv("DATABASE_STATEMENT_TIMEOUT_MS", "3500")

    settings = Settings.from_environment()

    assert settings == Settings(
        database_url="postgresql://postgres:secret@postgres/recruitment",
        internal_api_key="shared-secret",
        database_connect_timeout_seconds=7,
        database_statement_timeout_ms=3500,
    )


def test_settings_from_environment_uses_timeout_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://postgres/recruitment")
    monkeypatch.setenv("INTERNAL_API_KEY", "shared-secret")
    monkeypatch.delenv("DATABASE_CONNECT_TIMEOUT_SECONDS", raising=False)
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
    monkeypatch.setenv("DATABASE_URL", "postgresql://postgres/recruitment")
    monkeypatch.setenv("INTERNAL_API_KEY", "shared-secret")
    monkeypatch.delenv("DATABASE_CONNECT_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("DATABASE_STATEMENT_TIMEOUT_MS", raising=False)
    monkeypatch.setenv(name, value)

    with pytest.raises(
        RuntimeError,
        match=rf"{name} must be a positive integer",
    ):
        Settings.from_environment()


def test_application_lifespan_validates_configuration() -> None:
    settings = Settings(database_url="", internal_api_key="shared-secret")
    application = create_app(
        settings=settings,
        match_repository=UnusedRepository(),
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL must be configured"):
        with TestClient(application):
            pass
