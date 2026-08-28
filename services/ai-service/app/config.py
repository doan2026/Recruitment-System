"""Runtime configuration for the AI Service."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    internal_api_key: str
    internal_api_key_job_search: str = ""
    database_connect_timeout_seconds: int = 2
    database_statement_timeout_ms: int = 2_000

    @classmethod
    def from_environment(cls) -> Settings:
        return cls(
            database_url=os.getenv("DATABASE_URL", "").strip(),
            internal_api_key=os.getenv("INTERNAL_API_KEY", "").strip(),
            internal_api_key_job_search=os.getenv(
                "INTERNAL_API_KEY_JOB_SEARCH",
                "",
            ),
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
        if not self.internal_api_key_job_search:
            raise RuntimeError("INTERNAL_API_KEY_JOB_SEARCH must be configured")
        scoped_key = self.internal_api_key_job_search
        try:
            scoped_key_bytes = scoped_key.encode("ascii")
        except UnicodeEncodeError as error:
            raise RuntimeError("INTERNAL_API_KEY_JOB_SEARCH is invalid") from error
        if not 32 <= len(scoped_key_bytes) <= 512 or any(
            byte < 0x21 or byte > 0x7E for byte in scoped_key_bytes
        ):
            raise RuntimeError("INTERNAL_API_KEY_JOB_SEARCH is invalid")
        if self.internal_api_key_job_search == self.internal_api_key:
            raise RuntimeError(
                "INTERNAL_API_KEY_JOB_SEARCH must differ from INTERNAL_API_KEY"
            )


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
