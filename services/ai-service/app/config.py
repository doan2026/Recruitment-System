"""Runtime configuration for the AI Service."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    internal_api_key: str
    database_connect_timeout_seconds: int = 2
    database_statement_timeout_ms: int = 2_000

    @classmethod
    def from_environment(cls) -> Settings:
        return cls(
            database_url=os.getenv("DATABASE_URL", "").strip(),
            internal_api_key=os.getenv("INTERNAL_API_KEY", "").strip(),
            database_connect_timeout_seconds=_positive_int(
                "DATABASE_CONNECT_TIMEOUT_SECONDS",
                default=2,
            ),
            database_statement_timeout_ms=_positive_int(
                "DATABASE_STATEMENT_TIMEOUT_MS",
                default=2_000,
            ),
        )

    def validate(self) -> None:
        if not self.database_url:
            raise RuntimeError("DATABASE_URL must be configured")
        if not self.internal_api_key:
            raise RuntimeError("INTERNAL_API_KEY must be configured")


def _positive_int(name: str, *, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value
