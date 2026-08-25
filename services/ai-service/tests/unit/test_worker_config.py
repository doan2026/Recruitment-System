"""Unit tests for embedding-worker environment configuration."""

from __future__ import annotations

import pytest

from app.embedding import DEFAULT_MODEL_REVISION
from app.worker_config import JobWorkerSettings


def test_worker_settings_read_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", " postgresql://db ")
    monkeypatch.setenv("KAFKA_BROKERS", " kafka-a:9092, kafka-b:9092 ")
    monkeypatch.setenv("KAFKA_JOB_TOPIC", " jobs-v1 ")
    monkeypatch.setenv("KAFKA_JOB_CONSUMER_GROUP", " group-v1 ")
    monkeypatch.setenv("KAFKA_JOB_CONSUMER_CLIENT_ID", " worker-v1 ")
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", " model-v1 ")
    monkeypatch.setenv("EMBEDDING_MODEL_CACHE", " /cache ")
    monkeypatch.setenv("EMBEDDING_MODEL_REVISION", " revision-v1 ")
    monkeypatch.setenv("EMBEDDING_MODEL_LOCAL_FILES_ONLY", "true")
    monkeypatch.setenv("KAFKA_MAX_ATTEMPTS", "4")
    monkeypatch.setenv("KAFKA_RETRY_BACKOFF_SECONDS", "0.25")

    settings = JobWorkerSettings.from_environment()

    assert settings.database_url == "postgresql://db"
    assert settings.kafka_brokers == ("kafka-a:9092", "kafka-b:9092")
    assert settings.job_topic == "jobs-v1"
    assert settings.consumer_group == "group-v1"
    assert settings.client_id == "worker-v1"
    assert settings.model_name == "model-v1"
    assert settings.model_cache == "/cache"
    assert settings.model_revision == "revision-v1"
    assert settings.model_local_files_only is True
    assert settings.max_attempts == 4
    assert settings.retry_backoff_seconds == 0.25


def test_worker_settings_use_pinned_revision_when_environment_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EMBEDDING_MODEL_REVISION", raising=False)

    settings = JobWorkerSettings.from_environment()

    assert settings.model_revision == DEFAULT_MODEL_REVISION


def test_worker_consumer_config_enforces_safe_defaults() -> None:
    settings = JobWorkerSettings(
        database_url="postgresql://db",
        kafka_brokers=("kafka:9092",),
    )

    assert settings.consumer_config() == {
        "bootstrap.servers": "kafka:9092",
        "group.id": "ai-job-embedding-v1",
        "client.id": "ai-job-embedding-worker",
        "auto.offset.reset": "earliest",
        "allow.auto.create.topics": False,
        "max.poll.interval.ms": 900_000,
    }


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("database_url", "", "DATABASE_URL"),
        ("kafka_brokers", (), "KAFKA_BROKERS"),
        ("job_topic", "", "KAFKA_JOB_TOPIC"),
        ("consumer_group", "", "KAFKA_JOB_CONSUMER_GROUP"),
        ("client_id", "", "KAFKA_JOB_CONSUMER_CLIENT_ID"),
        ("model_name", "", "EMBEDDING_MODEL_NAME"),
        ("model_revision", "", "EMBEDDING_MODEL_REVISION"),
        ("embedding_dimension", 3, "EMBEDDING_DIMENSION"),
    ],
)
def test_worker_settings_reject_invalid_required_values(
    field: str,
    value: object,
    message: str,
) -> None:
    values: dict[str, object] = {
        "database_url": "postgresql://db",
        "kafka_brokers": ("kafka:9092",),
    }
    values[field] = value

    with pytest.raises(RuntimeError, match=message):
        JobWorkerSettings(**values).validate()  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("EMBEDDING_MODEL_LOCAL_FILES_ONLY", "maybe"),
        ("KAFKA_MAX_ATTEMPTS", "0"),
        ("KAFKA_RETRY_BACKOFF_SECONDS", "-1"),
        ("KAFKA_POLL_TIMEOUT_SECONDS", "0"),
        ("KAFKA_RECONNECT_BACKOFF_SECONDS", "not-a-number"),
        ("KAFKA_RETRY_BACKOFF_SECONDS", "nan"),
        ("KAFKA_POLL_TIMEOUT_SECONDS", "inf"),
    ],
)
def test_worker_settings_reject_invalid_environment(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
) -> None:
    monkeypatch.setenv(name, value)

    with pytest.raises(RuntimeError):
        JobWorkerSettings.from_environment()
