from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest

from app.media_client import (
    HttpMediaCvClient,
    MediaClientContractError,
    MediaClientUnavailable,
    MediaCvSourceRejected,
)

FILE_ID = UUID("44444444-4444-4444-8444-444444444444")
CANDIDATE_ID = UUID("33333333-3333-4333-8333-333333333333")
NOW = datetime(2026, 8, 28, 1, 0, tzinfo=UTC)
PDF = b"%PDF-private-cv"
KEY = "media-ai-test-key-that-is-at-least-32-bytes"


def test_owner_scoped_bounded_download_does_not_forward_internal_key() -> None:
    requests: list[httpx.Request] = []

    def internal(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["x-internal-service"] == "ai-service"
        assert request.headers["x-internal-api-key"] == KEY
        assert json.loads(request.content) == {
            "fileId": str(FILE_ID),
            "expectedOwnerType": "USER",
            "expectedOwnerId": str(CANDIDATE_ID),
            "expectedType": "CV",
        }
        if request.url.path == "/internal/verify":
            return json_response(metadata())
        return json_response(
            {
                "url": "https://download.test/private.pdf?token=short",
                "expiresAt": iso(NOW + timedelta(minutes=5)),
            }
        )

    def download(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert "x-internal-api-key" not in request.headers
        assert "x-internal-service" not in request.headers
        return httpx.Response(
            200,
            headers={"content-type": "application/pdf"},
            content=PDF,
        )

    client = media_client(internal, download)
    try:
        assert client.fetch_pdf(FILE_ID, CANDIDATE_ID) == PDF
    finally:
        client.close()
    assert [request.url.path for request in requests] == [
        "/internal/verify",
        "/internal/download-url",
        "/private.pdf",
    ]


def test_cloudinary_private_download_octet_stream_is_verified_as_pdf() -> None:
    def internal(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/internal/verify":
            return json_response(metadata())
        return json_response(
            {
                "url": "https://api.cloudinary.com/v1_1/cloud/raw/download?token=x",
                "expiresAt": iso(NOW + timedelta(minutes=5)),
            }
        )

    client = HttpMediaCvClient(
        base_url="http://media-service:3000",
        internal_api_key=KEY,
        allowed_download_hosts=("api.cloudinary.com",),
        clock=lambda: NOW,
        internal_transport=httpx.MockTransport(internal),
        download_transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                headers={"content-type": "application/octet-stream"},
                content=PDF,
            )
        ),
    )
    try:
        assert client.fetch_pdf(FILE_ID, CANDIDATE_ID) == PDF
    finally:
        client.close()


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_transient_media_statuses_remain_retryable(status: int) -> None:
    client = media_client(lambda _request: httpx.Response(status), unused_download)
    try:
        with pytest.raises(MediaClientUnavailable):
            client.fetch_pdf(FILE_ID, CANDIDATE_ID)
    finally:
        client.close()


@pytest.mark.parametrize("status", [404, 409])
def test_missing_or_inactive_source_is_terminal(status: int) -> None:
    client = media_client(lambda _request: httpx.Response(status), unused_download)
    try:
        with pytest.raises(MediaCvSourceRejected) as caught:
            client.fetch_pdf(FILE_ID, CANDIDATE_ID)
    finally:
        client.close()
    assert caught.value.code == "CV_SOURCE_UNAVAILABLE"


def test_malformed_metadata_and_unapproved_signed_host_fail_closed() -> None:
    def wrong_owner(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("verify"):
            return json_response(metadata(ownerId=str(FILE_ID)))
        raise AssertionError

    client = media_client(wrong_owner, unused_download)
    try:
        with pytest.raises(MediaClientContractError):
            client.fetch_pdf(FILE_ID, CANDIDATE_ID)
    finally:
        client.close()

    def reversed_timestamps(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("verify"):
            return json_response(
                metadata(
                    createdAt=iso(NOW),
                    updatedAt=iso(NOW - timedelta(seconds=1)),
                )
            )
        raise AssertionError

    client = media_client(reversed_timestamps, unused_download)
    try:
        with pytest.raises(MediaClientContractError):
            client.fetch_pdf(FILE_ID, CANDIDATE_ID)
    finally:
        client.close()

    def bad_host(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("verify"):
            return json_response(metadata())
        return json_response(
            {
                "url": "https://127.0.0.1/private.pdf",
                "expiresAt": iso(NOW + timedelta(minutes=5)),
            }
        )

    client = media_client(bad_host, unused_download)
    try:
        with pytest.raises(MediaClientContractError):
            client.fetch_pdf(FILE_ID, CANDIDATE_ID)
    finally:
        client.close()


def test_download_size_or_magic_mismatch_is_terminal_integrity_failure() -> None:
    def internal(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("verify"):
            return json_response(metadata())
        return json_response(
            {
                "url": "https://download.test/private.pdf",
                "expiresAt": iso(NOW + timedelta(minutes=5)),
            }
        )

    client = media_client(
        internal,
        lambda _request: httpx.Response(
            200,
            headers={"content-type": "application/pdf"},
            content=b"not-a-private-cv",
        ),
    )
    try:
        with pytest.raises(MediaCvSourceRejected) as caught:
            client.fetch_pdf(FILE_ID, CANDIDATE_ID)
    finally:
        client.close()
    assert caught.value.code == "CV_SOURCE_INTEGRITY_INVALID"


def test_redirect_is_never_followed() -> None:
    calls = 0

    def redirect(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    client = media_client(redirect, unused_download)
    try:
        with pytest.raises(MediaClientUnavailable):
            client.fetch_pdf(FILE_ID, CANDIDATE_ID)
    finally:
        client.close()
    assert calls == 1


def media_client(internal, download) -> HttpMediaCvClient:
    return HttpMediaCvClient(
        base_url="http://media-service:3000",
        internal_api_key=KEY,
        allowed_download_hosts=("download.test",),
        maximum_file_bytes=5 * 1024 * 1024,
        maximum_url_ttl_seconds=600,
        clock=lambda: NOW,
        internal_transport=httpx.MockTransport(internal),
        download_transport=httpx.MockTransport(download),
    )


def metadata(**overrides: object) -> dict[str, object]:
    return {
        "aggregateVersion": 2,
        "bytes": len(PDF),
        "createdAt": iso(NOW - timedelta(minutes=1)),
        "format": "pdf",
        "id": str(FILE_ID),
        "mimeType": "application/pdf",
        "originalFilename": "candidate.pdf",
        "ownerId": str(CANDIDATE_ID),
        "ownerType": "USER",
        "privateDelivery": True,
        "status": "ACTIVE",
        "type": "CV",
        "updatedAt": iso(NOW),
        "url": None,
        **overrides,
    }


def json_response(data: dict[str, object]) -> httpx.Response:
    return httpx.Response(
        200,
        headers={"content-type": "application/json"},
        json={"data": data, "meta": None},
    )


def unused_download(_request: httpx.Request) -> httpx.Response:
    raise AssertionError("download must not be called")


def iso(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
