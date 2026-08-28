"""Fail-closed Media client for ephemeral, owner-scoped CV downloads."""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import TracebackType
from typing import Protocol
from urllib.parse import urlsplit
from uuid import UUID

import httpx

_JSON_LIMIT = 64 * 1024
_PDF_CONTENT_TYPES = frozenset({"application/pdf", "application/octet-stream"})
_ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$")
_ENVELOPE_KEYS = frozenset({"data", "meta"})
_METADATA_KEYS = frozenset(
    {
        "aggregateVersion",
        "bytes",
        "createdAt",
        "format",
        "id",
        "mimeType",
        "originalFilename",
        "ownerId",
        "ownerType",
        "privateDelivery",
        "status",
        "type",
        "updatedAt",
        "url",
    }
)
_DOWNLOAD_KEYS = frozenset({"expiresAt", "url"})


class MediaCvSourceRejected(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class MediaClientUnavailable(RuntimeError):
    pass


class MediaClientContractError(RuntimeError):
    pass


class _BodyLimitExceeded(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class VerifiedCvFile:
    file_id: UUID
    candidate_id: UUID
    byte_count: int


class _StreamingResponse(Protocol):
    status_code: int
    headers: httpx.Headers

    def iter_bytes(self) -> Iterator[bytes]: ...

    def __enter__(self) -> _StreamingResponse: ...

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None: ...


class HttpMediaCvClient:
    def __init__(
        self,
        *,
        base_url: str,
        internal_api_key: str,
        allowed_download_hosts: tuple[str, ...],
        request_timeout_seconds: float = 5.0,
        download_timeout_seconds: float = 15.0,
        maximum_file_bytes: int = 5 * 1024 * 1024,
        maximum_url_ttl_seconds: int = 600,
        clock: Callable[[], datetime] | None = None,
        internal_transport: httpx.BaseTransport | None = None,
        download_transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base_url = _validate_base_url(base_url)
        self._internal_api_key = _validate_internal_key(internal_api_key)
        self._allowed_hosts = _validate_allowed_hosts(allowed_download_hosts)
        if request_timeout_seconds <= 0 or download_timeout_seconds <= 0:
            raise ValueError("Media timeouts must be positive")
        if maximum_file_bytes <= 0 or maximum_file_bytes > 5 * 1024 * 1024:
            raise ValueError("maximum_file_bytes must be between 1 and 5 MiB")
        if maximum_url_ttl_seconds <= 0 or maximum_url_ttl_seconds > 600:
            raise ValueError("maximum_url_ttl_seconds must be between 1 and 600")
        self._maximum_file_bytes = maximum_file_bytes
        self._maximum_url_ttl_seconds = maximum_url_ttl_seconds
        self._clock = clock or (lambda: datetime.now(UTC))
        self._internal = httpx.Client(
            base_url=self._base_url,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Internal-Service": "ai-service",
                "X-Internal-Api-Key": self._internal_api_key,
            },
            follow_redirects=False,
            timeout=request_timeout_seconds,
            trust_env=False,
            transport=internal_transport,
        )
        self._download = httpx.Client(
            follow_redirects=False,
            timeout=download_timeout_seconds,
            trust_env=False,
            transport=download_transport,
        )

    def close(self) -> None:
        self._internal.close()
        self._download.close()

    def fetch_pdf(self, file_id: UUID, candidate_id: UUID) -> bytes:
        expectation = {
            "fileId": str(file_id),
            "expectedOwnerType": "USER",
            "expectedOwnerId": str(candidate_id),
            "expectedType": "CV",
        }
        metadata = self._post_json("/internal/verify", expectation)
        verified = self._parse_metadata(metadata, file_id, candidate_id)
        download = self._post_json("/internal/download-url", expectation)
        url = self._parse_download(download)
        return self._download_pdf(url, verified.byte_count)

    def _post_json(self, path: str, payload: dict[str, str]) -> dict[str, object]:
        try:
            with self._internal.stream("POST", path, json=payload) as response:
                self._raise_for_status(response.status_code)
                content_type = response.headers.get("content-type", "")
                if not re.match(r"^application/json(?:\s*;|$)", content_type, re.I):
                    raise MediaClientContractError
                try:
                    raw = _read_bounded(response, _JSON_LIMIT)
                except _BodyLimitExceeded:
                    raise MediaClientContractError from None
        except MediaCvSourceRejected:
            raise
        except MediaClientContractError:
            raise
        except httpx.HTTPError as error:
            raise MediaClientUnavailable from error
        try:
            parsed = httpx.Response(200, content=raw).json()
        except ValueError:
            raise MediaClientContractError from None
        if not isinstance(parsed, dict) or frozenset(parsed) != _ENVELOPE_KEYS:
            raise MediaClientContractError
        if parsed.get("meta") is not None or not isinstance(parsed.get("data"), dict):
            raise MediaClientContractError
        return parsed["data"]

    def _raise_for_status(self, status: int) -> None:
        if 200 <= status < 300:
            return
        if status in {404, 409}:
            raise MediaCvSourceRejected("CV_SOURCE_UNAVAILABLE")
        if status in {400, 422}:
            raise MediaCvSourceRejected("CV_SOURCE_INVALID")
        raise MediaClientUnavailable

    def _parse_metadata(
        self,
        data: dict[str, object],
        file_id: UUID,
        candidate_id: UUID,
    ) -> VerifiedCvFile:
        byte_count = data.get("bytes")
        created_at = _parse_utc_timestamp(data.get("createdAt"))
        updated_at = _parse_utc_timestamp(data.get("updatedAt"))
        if (
            frozenset(data) != _METADATA_KEYS
            or data.get("id") != str(file_id)
            or data.get("ownerType") != "USER"
            or data.get("ownerId") != str(candidate_id)
            or data.get("type") != "CV"
            or data.get("status") != "ACTIVE"
            or data.get("format") != "pdf"
            or data.get("mimeType") != "application/pdf"
            or data.get("privateDelivery") is not True
            or data.get("url") is not None
            or type(byte_count) is not int
            or byte_count <= 0
            or byte_count > self._maximum_file_bytes
            or type(data.get("aggregateVersion")) is not int
            or data["aggregateVersion"] < 1
            or not isinstance(data.get("originalFilename"), str)
            or not data["originalFilename"]
            or created_at is None
            or updated_at is None
            or updated_at < created_at
        ):
            raise MediaClientContractError
        return VerifiedCvFile(file_id, candidate_id, byte_count)

    def _parse_download(self, data: dict[str, object]) -> str:
        if frozenset(data) != _DOWNLOAD_KEYS:
            raise MediaClientContractError
        url = data.get("url")
        expires_at = _parse_utc_timestamp(data.get("expiresAt"))
        now = self._clock().astimezone(UTC)
        if (
            not isinstance(url, str)
            or expires_at is None
            or expires_at <= now
            or expires_at > now + timedelta(seconds=self._maximum_url_ttl_seconds)
        ):
            raise MediaClientContractError
        parsed = urlsplit(url)
        hostname = (parsed.hostname or "").lower()
        if (
            parsed.scheme != "https"
            or hostname not in self._allowed_hosts
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or parsed.port not in {None, 443}
        ):
            raise MediaClientContractError
        return url

    def _download_pdf(self, url: str, expected_bytes: int) -> bytes:
        try:
            with self._download.stream(
                "GET",
                url,
                headers={"Accept": "application/pdf"},
            ) as response:
                self._raise_for_status(response.status_code)
                content_type = (
                    response.headers.get("content-type", "")
                    .split(";", 1)[0]
                    .strip()
                    .lower()
                )
                if content_type not in _PDF_CONTENT_TYPES:
                    raise MediaCvSourceRejected("CV_SOURCE_INVALID")
                declared = response.headers.get("content-length")
                if declared is not None and (
                    not declared.isdigit()
                    or int(declared) != expected_bytes
                    or int(declared) > self._maximum_file_bytes
                ):
                    raise MediaCvSourceRejected("CV_SOURCE_INTEGRITY_INVALID")
                try:
                    content = _read_bounded(response, self._maximum_file_bytes)
                except _BodyLimitExceeded:
                    raise MediaCvSourceRejected("CV_SOURCE_INTEGRITY_INVALID") from None
        except MediaCvSourceRejected:
            raise
        except httpx.HTTPError as error:
            raise MediaClientUnavailable from error
        if len(content) != expected_bytes or not content.startswith(b"%PDF-"):
            raise MediaCvSourceRejected("CV_SOURCE_INTEGRITY_INVALID")
        return content


def _read_bounded(response: _StreamingResponse, maximum: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > maximum:
            raise _BodyLimitExceeded
        chunks.append(chunk)
    return b"".join(chunks)


def _validate_base_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("MEDIA_SERVICE_URL is invalid")
    return f"{parsed.scheme}://{parsed.netloc}"


def _validate_internal_key(value: str) -> str:
    key = value.strip()
    if (
        len(key.encode("utf-8")) < 32
        or "replace-with" in key.lower()
        or any(ord(character) < 32 or ord(character) == 127 for character in key)
    ):
        raise ValueError("MEDIA_INTERNAL_API_KEY is invalid")
    return key


def _validate_allowed_hosts(values: tuple[str, ...]) -> frozenset[str]:
    hosts: set[str] = set()
    for value in values:
        host = value.strip().lower().rstrip(".")
        if not host or ":" in host or "/" in host:
            raise ValueError("MEDIA_DOWNLOAD_ALLOWED_HOSTS is invalid")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError("Media download hosts must not be IP literals")
        hosts.add(host)
    if not hosts:
        raise ValueError("MEDIA_DOWNLOAD_ALLOWED_HOSTS must not be empty")
    return frozenset(hosts)


def _parse_utc_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not _ISO_UTC.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00").astimezone(UTC)
    except ValueError:
        return None
