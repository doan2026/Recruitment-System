"""Fixed-origin Candidate Job recommendation client for the chat intent tool."""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from time import monotonic
from typing import Any, NoReturn, Protocol
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from app.job_events import JobType

CHAT_RECOMMENDATION_JOB_LIMIT = 3
MAXIMUM_JOB_RESPONSE_BYTES = 256 * 1024
MAXIMUM_ACCESS_TOKEN_BYTES = 8 * 1024
MAXIMUM_RECOMMENDATION_ANSWER_BYTES = 24 * 1024
_MONEY_PATTERN = re.compile(r"^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$")
_CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")
_MARKDOWN_META_PATTERN = re.compile(r"([\\`*_{}\[\]()#+.!|>])")


class JobRecommendationUnavailable(RuntimeError):
    """The fixed Job endpoint did not return a safe bounded snapshot."""


class JobRecommendationSource(StrEnum):
    AI = "AI"
    PREFERENCES = "PREFERENCES"
    LATEST = "LATEST"


class JobRecommendationFallbackReason(StrEnum):
    NO_ACTIVE_CV = "NO_ACTIVE_CV"
    PROFILE_UNAVAILABLE = "PROFILE_UNAVAILABLE"
    AI_UNAVAILABLE = "AI_UNAVAILABLE"
    AI_NOT_READY = "AI_NOT_READY"
    AI_RESPONSE_INVALID = "AI_RESPONSE_INVALID"
    AI_RESULTS_STALE = "AI_RESULTS_STALE"


class _WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _WireJobCard(_WireModel):
    id: str
    company_id: str = Field(alias="companyId")
    title: str
    description: str
    salary_min: str | None = Field(alias="salaryMin")
    salary_max: str | None = Field(alias="salaryMax")
    is_negotiable: bool = Field(alias="isNegotiable", strict=True)
    currency: str
    location: str
    job_type: JobType = Field(alias="jobType")
    experience_years: int = Field(
        alias="experienceYears",
        strict=True,
        ge=0,
        le=60,
    )
    skills: list[str]
    deadline: str
    published_at: str | None = Field(alias="publishedAt")
    company_name: str | None = Field(alias="companyName")
    score: float | None = Field(strict=True, ge=0.0, le=1.0)

    @field_validator("id", "company_id")
    @classmethod
    def require_canonical_uuid_v4(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("identifier must be a string")
        try:
            parsed = UUID(value)
        except ValueError as error:
            raise ValueError("identifier must be a UUID") from error
        if parsed.version != 4 or str(parsed) != value:
            raise ValueError("identifier must be a canonical UUID v4")
        return value

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        return _safe_single_line(value, minimum=2, maximum=200)

    @field_validator("location")
    @classmethod
    def validate_location(cls, value: str) -> str:
        return _safe_single_line(value, minimum=1, maximum=255)

    @field_validator("company_name")
    @classmethod
    def validate_company_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _safe_single_line(value, minimum=1, maximum=255)

    @field_validator("description")
    @classmethod
    def validate_discarded_description(cls, value: str) -> str:
        if not isinstance(value, str) or not 1 <= len(value) <= 20_000:
            raise ValueError("description is invalid")
        return value

    @field_validator("salary_min", "salary_max")
    @classmethod
    def validate_salary(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str) or not _MONEY_PATTERN.fullmatch(value):
            raise ValueError("salary is invalid")
        try:
            amount = Decimal(value)
        except InvalidOperation as error:
            raise ValueError("salary is invalid") from error
        if amount > Decimal("9999999999999.99"):
            raise ValueError("salary is invalid")
        return value

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        if not isinstance(value, str) or not _CURRENCY_PATTERN.fullmatch(value):
            raise ValueError("currency is invalid")
        return value

    @field_validator("skills")
    @classmethod
    def validate_discarded_skills(cls, value: list[str]) -> list[str]:
        if not isinstance(value, list) or len(value) > 50:
            raise ValueError("skills are invalid")
        for skill in value:
            if (
                not isinstance(skill, str)
                or not 1 <= len(skill) <= 255
                or _contains_unsafe_control(skill)
            ):
                raise ValueError("skills are invalid")
        return value

    @field_validator("deadline")
    @classmethod
    def validate_deadline(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("deadline is invalid")
        try:
            parsed = date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("deadline is invalid") from error
        if parsed.isoformat() != value or parsed < datetime.now(UTC).date():
            raise ValueError("deadline is invalid")
        return value

    @field_validator("published_at")
    @classmethod
    def validate_published_at(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str) or len(value) > 64:
            raise ValueError("publishedAt is invalid")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("publishedAt is invalid") from error
        if parsed.tzinfo is None:
            raise ValueError("publishedAt is invalid")
        return value

    @model_validator(mode="after")
    def validate_salary_contract(self) -> _WireJobCard:
        if self.is_negotiable:
            if self.salary_min is not None or self.salary_max is not None:
                raise ValueError("negotiable salary contract is invalid")
            return self
        if self.salary_min is None or self.salary_max is None:
            raise ValueError("fixed salary contract is invalid")
        if Decimal(self.salary_min) > Decimal(self.salary_max):
            raise ValueError("fixed salary contract is invalid")
        return self


class _WireRecommendationData(_WireModel):
    items: list[_WireJobCard] = Field(max_length=CHAT_RECOMMENDATION_JOB_LIMIT)
    next_cursor: str | None = Field(
        alias="nextCursor",
        min_length=1,
        max_length=1024,
    )
    source: JobRecommendationSource
    fallback_reason: JobRecommendationFallbackReason | None = Field(
        alias="fallbackReason",
    )

    @model_validator(mode="after")
    def validate_source_invariants(self) -> _WireRecommendationData:
        item_ids = [item.id for item in self.items]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("recommendation item identifiers must be unique")
        if self.source is JobRecommendationSource.AI:
            scores = [item.score for item in self.items]
            if (
                not self.items
                or self.fallback_reason is not None
                or any(score is None for score in scores)
                or any(
                    current > previous
                    for previous, current in zip(scores, scores[1:], strict=False)
                    if previous is not None and current is not None
                )
            ):
                raise ValueError("AI recommendation cannot have a fallback reason")
        else:
            if (
                self.next_cursor is not None
                or self.fallback_reason is None
                or any(item.score is not None for item in self.items)
            ):
                raise ValueError("fallback recommendation contract is invalid")
        return self


class _WireRecommendationEnvelope(_WireModel):
    data: _WireRecommendationData
    meta: None


@dataclass(frozen=True, slots=True)
class JobRecommendationCard:
    job_id: str
    title: str
    company_name: str | None
    location: str
    job_type: JobType
    salary_min: str | None
    salary_max: str | None
    is_negotiable: bool
    currency: str
    score: float | None


@dataclass(frozen=True, slots=True)
class JobRecommendationSnapshot:
    items: tuple[JobRecommendationCard, ...]
    source: JobRecommendationSource
    fallback_reason: JobRecommendationFallbackReason | None


class CandidateJobRecommendationClient(Protocol):
    def recommend(self, access_token: str) -> JobRecommendationSnapshot: ...


class HttpCandidateJobRecommendationClient:
    def __init__(
        self,
        *,
        endpoint: str,
        allowed_hosts: tuple[str, ...],
        allow_insecure_http: bool,
        timeout_seconds: int,
        client: httpx.Client | None = None,
    ) -> None:
        _validate_endpoint(endpoint, allowed_hosts, allow_insecure_http)
        if not 1 <= timeout_seconds <= 5:
            raise ValueError("job recommendation timeout is invalid")
        self._endpoint = endpoint
        self._timeout_seconds = float(timeout_seconds)
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(self._timeout_seconds),
            follow_redirects=False,
            trust_env=False,
        )

    def close(self) -> None:
        if not self._owns_client:
            return
        try:
            self._client.close()
        except Exception:
            # Best-effort cleanup must not expose endpoint details.
            pass

    def recommend(self, access_token: str) -> JobRecommendationSnapshot:
        try:
            return self._recommend(access_token)
        except JobRecommendationUnavailable:
            raise
        except Exception:
            raise JobRecommendationUnavailable(
                "job recommendations unavailable"
            ) from None

    def _recommend(self, access_token: str) -> JobRecommendationSnapshot:
        _validate_access_token(access_token)
        deadline = monotonic() + self._timeout_seconds
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {access_token}",
        }
        try:
            with self._client.stream(
                "GET",
                self._endpoint,
                params={"limit": str(CHAT_RECOMMENDATION_JOB_LIMIT)},
                headers=headers,
            ) as response:
                if response.status_code != 200 or response.is_redirect:
                    raise JobRecommendationUnavailable(
                        "job recommendations unavailable"
                    )
                _ensure_before_deadline(deadline)
                _validate_response_headers(response.headers)
                body = _read_bounded_body(response, deadline)
        except JobRecommendationUnavailable:
            raise
        except httpx.HTTPError:
            raise JobRecommendationUnavailable(
                "job recommendations unavailable"
            ) from None

        try:
            decoded = body.decode("utf-8")
            document = json.loads(
                decoded,
                object_pairs_hook=_reject_duplicate_keys,
                parse_constant=_reject_json_constant,
            )
            envelope = _WireRecommendationEnvelope.model_validate(document)
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError):
            raise JobRecommendationUnavailable(
                "job recommendations unavailable"
            ) from None

        return JobRecommendationSnapshot(
            items=tuple(
                JobRecommendationCard(
                    job_id=item.id,
                    title=item.title,
                    company_name=item.company_name,
                    location=item.location,
                    job_type=item.job_type,
                    salary_min=item.salary_min,
                    salary_max=item.salary_max,
                    is_negotiable=item.is_negotiable,
                    currency=item.currency,
                    score=item.score,
                )
                for item in envelope.data.items
            ),
            source=envelope.data.source,
            fallback_reason=envelope.data.fallback_reason,
        )


def format_job_recommendations(
    snapshot: JobRecommendationSnapshot,
    current_message: str,
) -> str:
    english = _prefers_english(current_message)
    if not snapshot.items:
        return _empty_answer(english)

    if english:
        if snapshot.source is JobRecommendationSource.AI:
            introduction = "Here are current job suggestions for you:"
        elif snapshot.source is JobRecommendationSource.PREFERENCES:
            introduction = "Here are current jobs based on your saved preferences:"
        else:
            introduction = (
                "Personalized matching is unavailable, so here are recent jobs:"
            )
    elif snapshot.source is JobRecommendationSource.AI:
        introduction = "Mình tìm thấy các gợi ý việc làm hiện tại cho bạn:"
    elif snapshot.source is JobRecommendationSource.PREFERENCES:
        introduction = "Đây là các việc hiện tại dựa trên ưu tiên bạn đã lưu:"
    else:
        introduction = "Chưa thể cá nhân hóa, nên đây là các việc mới hiện có:"

    lines = [introduction]
    for index, item in enumerate(snapshot.items, start=1):
        title = _escape_markdown(item.title)
        company = (
            f" — {_escape_markdown(item.company_name)}" if item.company_name else ""
        )
        location = _escape_markdown(item.location)
        job_type = _job_type_label(item.job_type, english)
        salary = _salary_label(item, english)
        score = ""
        if item.score is not None:
            percentage = round(item.score * 100)
            score = (
                f"; reference similarity {percentage}%"
                if english
                else f"; tương đồng tham khảo {percentage}%"
            )
        identifier = "job ID" if english else "mã việc"
        lines.append(
            f"{index}. {title}{company} — {location}; {job_type}; {salary}"
            f"{score}; {identifier} {item.job_id}"
        )
    lines.append(
        "Open the Suitable Jobs screen to review details and current availability."
        if english
        else (
            "Hãy mở màn “Việc làm phù hợp” để xem chi tiết và trạng thái " "mới nhất."
        )
    )
    answer = "\n".join(lines)
    if len(answer.encode("utf-8")) > MAXIMUM_RECOMMENDATION_ANSWER_BYTES:
        return _empty_answer(english)
    return answer


def format_job_recommendation_unavailable(current_message: str) -> str:
    if _prefers_english(current_message):
        return (
            "I can’t load job suggestions right now. Please open the Suitable Jobs "
            "screen and try again shortly."
        )
    return (
        "Mình chưa thể tải gợi ý việc làm lúc này. Bạn hãy mở màn "
        "“Việc làm phù hợp” và thử lại sau ít phút."
    )


def _empty_answer(english: bool) -> str:
    if english:
        return (
            "I couldn’t find a current job suggestion in this snapshot. "
            "Open the Suitable Jobs screen to adjust preferences and try again."
        )
    return (
        "Mình chưa tìm thấy gợi ý việc làm trong lần kiểm tra này. "
        "Bạn hãy mở màn “Việc làm phù hợp” để điều chỉnh ưu tiên và thử lại."
    )


def _salary_label(item: JobRecommendationCard, english: bool) -> str:
    if item.is_negotiable:
        return "Negotiable salary" if english else "Lương thỏa thuận"
    if item.salary_min is not None and item.salary_max is not None:
        return f"{item.salary_min}–{item.salary_max} {item.currency}"
    if item.salary_min is not None:
        prefix = "From" if english else "Từ"
        return f"{prefix} {item.salary_min} {item.currency}"
    if item.salary_max is not None:
        prefix = "Up to" if english else "Tối đa"
        return f"{prefix} {item.salary_max} {item.currency}"
    return "Salary not listed" if english else "Chưa niêm yết lương"


def _job_type_label(job_type: JobType, english: bool) -> str:
    english_labels = {
        JobType.FULL_TIME: "Full-time",
        JobType.PART_TIME: "Part-time",
        JobType.REMOTE: "Remote",
        JobType.INTERNSHIP: "Internship",
    }
    vietnamese_labels = {
        JobType.FULL_TIME: "Toàn thời gian",
        JobType.PART_TIME: "Bán thời gian",
        JobType.REMOTE: "Làm từ xa",
        JobType.INTERNSHIP: "Thực tập",
    }
    return (english_labels if english else vietnamese_labels)[job_type]


def _prefers_english(message: str) -> bool:
    folded = unicodedata.normalize("NFC", message).casefold()
    english_markers = ("job", "recommend", "suitable", "career", "work")
    vietnamese_markers = ("tôi", "việc", "làm", "gợi ý", "phù hợp", "nghề")
    return any(marker in folded for marker in english_markers) and not any(
        marker in folded for marker in vietnamese_markers
    )


def _escape_markdown(value: str) -> str:
    neutralized = re.sub(
        r"(?i)\bhttps://",
        "hxxps://",
        re.sub(r"(?i)\bhttp://", "hxxp://", value),
    )
    return _MARKDOWN_META_PATTERN.sub(r"\\\1", neutralized)


def _safe_single_line(value: str, *, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError("text field must be a string")
    normalized = unicodedata.normalize("NFC", value).strip()
    if (
        not minimum <= len(normalized) <= maximum
        or _contains_unsafe_control(normalized)
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise ValueError("text field is invalid")
    return normalized


def _contains_unsafe_control(value: str) -> bool:
    return any(
        ord(character) < 32 or 127 <= ord(character) <= 159 for character in value
    )


def _validate_access_token(access_token: str) -> None:
    if (
        not isinstance(access_token, str)
        or not access_token
        or len(access_token.encode("utf-8")) > MAXIMUM_ACCESS_TOKEN_BYTES
        or any(
            ord(character) < 0x21 or ord(character) > 0x7E for character in access_token
        )
    ):
        raise JobRecommendationUnavailable("job recommendations unavailable")


def _validate_endpoint(
    endpoint: str,
    allowed_hosts: tuple[str, ...],
    allow_insecure_http: bool,
) -> None:
    if (
        not endpoint
        or any(ord(character) < 0x21 or ord(character) > 0x7E for character in endpoint)
        or "%" in endpoint
        or "\\" in endpoint
    ):
        raise ValueError("job recommendation endpoint is invalid")
    try:
        parsed = urlsplit(endpoint)
        port = parsed.port
    except ValueError as error:
        raise ValueError("job recommendation endpoint is invalid") from error
    hostname = parsed.hostname
    if (
        parsed.scheme not in {"http", "https"}
        or (parsed.scheme == "http" and not allow_insecure_http)
        or hostname is None
        or hostname != hostname.lower()
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path != "/recommended"
        or parsed.query
        or parsed.fragment
        or not allowed_hosts
        or hostname not in allowed_hosts
    ):
        raise ValueError("job recommendation endpoint is invalid")
    expected_netloc = hostname if port is None else f"{hostname}:{port}"
    if parsed.netloc != expected_netloc:
        raise ValueError("job recommendation endpoint is invalid")


def _validate_response_headers(headers: httpx.Headers) -> None:
    content_type = headers.get("content-type", "")
    media_type, separator, parameters = content_type.partition(";")
    if media_type.strip().lower() != "application/json":
        raise JobRecommendationUnavailable("job recommendations unavailable")
    if separator and parameters.strip().lower() not in {
        "charset=utf-8",
        "charset=utf8",
    }:
        raise JobRecommendationUnavailable("job recommendations unavailable")
    content_encoding = headers.get("content-encoding", "").strip().lower()
    if content_encoding not in {"", "identity"}:
        raise JobRecommendationUnavailable("job recommendations unavailable")
    content_length = headers.get("content-length")
    if content_length is not None:
        try:
            parsed_length = int(content_length)
        except ValueError:
            raise JobRecommendationUnavailable(
                "job recommendations unavailable"
            ) from None
        if parsed_length < 0 or parsed_length > MAXIMUM_JOB_RESPONSE_BYTES:
            raise JobRecommendationUnavailable("job recommendations unavailable")
    cache_control = {
        directive.strip().lower()
        for directive in headers.get("cache-control", "").split(",")
    }
    vary = {
        directive.strip().lower() for directive in headers.get("vary", "").split(",")
    }
    if (
        "no-store" not in cache_control
        or headers.get("pragma", "").strip().lower() != "no-cache"
        or "authorization" not in vary
    ):
        raise JobRecommendationUnavailable("job recommendations unavailable")


def _read_bounded_body(response: httpx.Response, deadline: float) -> bytes:
    body = bytearray()
    for chunk in response.iter_raw():
        _ensure_before_deadline(deadline)
        if len(chunk) > MAXIMUM_JOB_RESPONSE_BYTES - len(body):
            raise JobRecommendationUnavailable("job recommendations unavailable")
        body.extend(chunk)
    if not body:
        raise JobRecommendationUnavailable("job recommendations unavailable")
    return bytes(body)


def _ensure_before_deadline(deadline: float) -> None:
    if monotonic() >= deadline:
        raise JobRecommendationUnavailable("job recommendations unavailable")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _reject_json_constant(_: str) -> NoReturn:
    raise ValueError("non-finite JSON number")
