from __future__ import annotations

import pytest

from app.worker_config import CvWorkerSettings

KEY = "media-ai-test-key-that-is-at-least-32-bytes"


def test_defaults_to_exact_cloudinary_private_download_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://db")
    monkeypatch.setenv("KAFKA_BROKERS", "kafka:9092")
    monkeypatch.setenv("MEDIA_SERVICE_URL", "http://media-service:3000")
    monkeypatch.setenv("MEDIA_INTERNAL_API_KEY", KEY)
    monkeypatch.delenv("MEDIA_DOWNLOAD_ALLOWED_HOSTS", raising=False)

    settings = CvWorkerSettings.from_environment()
    settings.validate()
    assert settings.media_download_allowed_hosts == (
        "api.cloudinary.com",
        "res.cloudinary.com",
    )


def test_reads_dedicated_cv_media_parser_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", " postgresql://db ")
    monkeypatch.setenv("KAFKA_BROKERS", " kafka:9092 ")
    monkeypatch.setenv("MEDIA_SERVICE_URL", " http://media-service:3000 ")
    monkeypatch.setenv("MEDIA_INTERNAL_API_KEY", KEY)
    monkeypatch.setenv(
        "MEDIA_DOWNLOAD_ALLOWED_HOSTS",
        " api.cloudinary.com,res.cloudinary.com,download.test. ",
    )
    monkeypatch.setenv("KAFKA_CV_TOPIC", " cvs-v1 ")
    monkeypatch.setenv("CV_PDF_MAXIMUM_PAGES", "42")

    settings = CvWorkerSettings.from_environment()
    settings.validate()

    assert settings.cv_topic == "cvs-v1"
    assert settings.media_internal_api_key == KEY
    assert settings.media_download_allowed_hosts == (
        "api.cloudinary.com",
        "res.cloudinary.com",
        "download.test",
    )
    assert settings.pdf_maximum_pages == 42
    assert settings.consumer_config()["group.id"] == "ai-cv-embedding-v1"


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("media_service_url", "", "MEDIA_SERVICE_URL"),
        ("media_internal_api_key", "short", "MEDIA_INTERNAL_API_KEY"),
        ("media_download_allowed_hosts", (), "MEDIA_DOWNLOAD_ALLOWED_HOSTS"),
        ("media_maximum_file_bytes", 5 * 1024 * 1024 + 1, "FILE_BYTES"),
        ("media_maximum_url_ttl_seconds", 601, "URL_TTL"),
        ("max_attempts", 4, "KAFKA_MAX_ATTEMPTS"),
        ("retry_backoff_seconds", 31, "KAFKA_RETRY_BACKOFF_SECONDS"),
        ("reconnect_backoff_seconds", 61, "KAFKA_RECONNECT_BACKOFF_SECONDS"),
        ("database_statement_timeout_ms", 60_001, "STATEMENT_TIMEOUT"),
        ("media_request_timeout_seconds", 31, "MEDIA_REQUEST_TIMEOUT"),
        ("media_download_timeout_seconds", 61, "MEDIA_DOWNLOAD_TIMEOUT"),
        ("pdf_parser_timeout_seconds", 31, "PARSER_TIMEOUT"),
        ("pdf_maximum_pages", 101, "MAXIMUM_PAGES"),
        ("pdf_maximum_text_characters", 500_001, "TEXT_CHARACTERS"),
    ],
)
def test_fail_fast_configuration(
    field: str,
    value: object,
    message: str,
) -> None:
    values: dict[str, object] = {
        "database_url": "postgresql://db",
        "kafka_brokers": ("kafka:9092",),
        "media_service_url": "http://media-service:3000",
        "media_internal_api_key": KEY,
        "media_download_allowed_hosts": ("res.cloudinary.com",),
    }
    values[field] = value
    with pytest.raises(RuntimeError, match=message):
        CvWorkerSettings(**values).validate()  # type: ignore[arg-type]
