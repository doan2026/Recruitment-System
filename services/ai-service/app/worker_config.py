"""Environment configuration for the dedicated embedding worker."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

from app.embedding import (
    DEFAULT_MODEL_NAME,
    DEFAULT_MODEL_REVISION,
    EMBEDDING_DIMENSION,
)


@dataclass(frozen=True, slots=True)
class JobWorkerSettings:
    database_url: str
    kafka_brokers: tuple[str, ...]
    job_topic: str = "job-events"
    consumer_group: str = "ai-job-embedding-v1"
    client_id: str = "ai-job-embedding-worker"
    model_name: str = DEFAULT_MODEL_NAME
    model_cache: str | None = "/models"
    model_revision: str = DEFAULT_MODEL_REVISION
    model_local_files_only: bool = False
    embedding_dimension: int = EMBEDDING_DIMENSION
    max_attempts: int = 3
    retry_backoff_seconds: float = 1.0
    poll_timeout_seconds: float = 1.0
    reconnect_backoff_seconds: float = 5.0
    database_connect_timeout_seconds: int = 2
    database_statement_timeout_ms: int = 10_000

    @classmethod
    def from_environment(cls) -> JobWorkerSettings:
        return cls(
            database_url=os.getenv("DATABASE_URL", "").strip(),
            kafka_brokers=_brokers(os.getenv("KAFKA_BROKERS", "")),
            job_topic=os.getenv("KAFKA_JOB_TOPIC", "job-events").strip(),
            consumer_group=os.getenv(
                "KAFKA_JOB_CONSUMER_GROUP",
                "ai-job-embedding-v1",
            ).strip(),
            client_id=os.getenv(
                "KAFKA_JOB_CONSUMER_CLIENT_ID",
                "ai-job-embedding-worker",
            ).strip(),
            model_name=os.getenv(
                "EMBEDDING_MODEL_NAME",
                DEFAULT_MODEL_NAME,
            ).strip(),
            model_cache=_optional_text(os.getenv("EMBEDDING_MODEL_CACHE", "/models")),
            model_revision=os.getenv(
                "EMBEDDING_MODEL_REVISION",
                DEFAULT_MODEL_REVISION,
            ).strip(),
            model_local_files_only=_boolean(
                "EMBEDDING_MODEL_LOCAL_FILES_ONLY",
                default=False,
            ),
            embedding_dimension=_positive_int(
                "EMBEDDING_DIMENSION",
                default=EMBEDDING_DIMENSION,
            ),
            max_attempts=_positive_int("KAFKA_MAX_ATTEMPTS", default=3),
            retry_backoff_seconds=_non_negative_float(
                "KAFKA_RETRY_BACKOFF_SECONDS",
                default=1.0,
            ),
            poll_timeout_seconds=_positive_float(
                "KAFKA_POLL_TIMEOUT_SECONDS",
                default=1.0,
            ),
            reconnect_backoff_seconds=_non_negative_float(
                "KAFKA_RECONNECT_BACKOFF_SECONDS",
                default=5.0,
            ),
            database_connect_timeout_seconds=_positive_int(
                "DATABASE_CONNECT_TIMEOUT_SECONDS",
                default=2,
            ),
            database_statement_timeout_ms=_positive_int(
                "DATABASE_STATEMENT_TIMEOUT_MS",
                default=10_000,
            ),
        )

    def validate(self) -> None:
        required = {
            "DATABASE_URL": self.database_url,
            "KAFKA_BROKERS": ",".join(self.kafka_brokers),
            "KAFKA_JOB_TOPIC": self.job_topic,
            "KAFKA_JOB_CONSUMER_GROUP": self.consumer_group,
            "KAFKA_JOB_CONSUMER_CLIENT_ID": self.client_id,
            "EMBEDDING_MODEL_NAME": self.model_name,
            "EMBEDDING_MODEL_REVISION": self.model_revision,
        }
        for name, value in required.items():
            if not value:
                raise RuntimeError(f"{name} must be configured")
        if self.embedding_dimension != EMBEDDING_DIMENSION:
            raise RuntimeError(f"EMBEDDING_DIMENSION must be {EMBEDDING_DIMENSION}")

    def consumer_config(self) -> dict[str, object]:
        self.validate()
        return {
            "bootstrap.servers": ",".join(self.kafka_brokers),
            "group.id": self.consumer_group,
            "client.id": self.client_id,
            "auto.offset.reset": "earliest",
            "allow.auto.create.topics": False,
            "max.poll.interval.ms": 900_000,
        }


def _brokers(raw_value: str) -> tuple[str, ...]:
    return tuple(broker for item in raw_value.split(",") if (broker := item.strip()))


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _boolean(name: str, *, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean")


def _positive_int(name: str, *, default: int) -> int:
    raw_value = os.getenv(name)
    try:
        value = default if raw_value is None else int(raw_value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


def _positive_float(name: str, *, default: float) -> float:
    value = _float(name, default=default)
    if value <= 0:
        raise RuntimeError(f"{name} must be positive")
    return value


def _non_negative_float(name: str, *, default: float) -> float:
    value = _float(name, default=default)
    if value < 0:
        raise RuntimeError(f"{name} must not be negative")
    return value


def _float(name: str, *, default: float) -> float:
    raw_value = os.getenv(name)
    try:
        value = default if raw_value is None else float(raw_value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a finite number") from error
    if not math.isfinite(value):
        raise RuntimeError(f"{name} must be a finite number")
    return value
