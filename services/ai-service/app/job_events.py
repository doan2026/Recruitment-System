"""Strict contract handling for Job Search Service Kafka events."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import NoReturn, TypeVar, cast
from uuid import UUID


class JobEventAction(StrEnum):
    CREATED = "CREATED"
    UPDATED = "UPDATED"
    CLOSED = "CLOSED"
    EXPIRED = "EXPIRED"


class JobStatus(StrEnum):
    DRAFT = "DRAFT"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    PUBLISHED = "PUBLISHED"
    CLOSED = "CLOSED"
    EXPIRED = "EXPIRED"


class JobType(StrEnum):
    FULL_TIME = "FULL_TIME"
    PART_TIME = "PART_TIME"
    REMOTE = "REMOTE"
    INTERNSHIP = "INTERNSHIP"


_EnumType = TypeVar("_EnumType", bound=StrEnum)


class JobEventContractError(ValueError):
    """A stable, payload-safe error raised for an invalid Job event."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        field: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.field = field


@dataclass(frozen=True, slots=True)
class JobEvent:
    event_id: UUID
    action: JobEventAction
    job_id: UUID
    company_id: UUID
    title: str
    description: str
    skills: tuple[str, ...]
    location: str
    status: JobStatus
    occurred_at: datetime
    schema_version: int
    aggregate_version: int | None
    requirements: str | None
    salary_min: Decimal | None
    salary_max: Decimal | None
    job_type: JobType | None

    @property
    def is_active(self) -> bool:
        return self.status is JobStatus.PUBLISHED


@dataclass(frozen=True, slots=True)
class JobEmbeddingDocument:
    """Ephemeral normalized text plus the only value safe to persist."""

    text: str
    text_hash: str


_MAX_BIGINT = 9_223_372_036_854_775_807
_MAX_MONEY = Decimal("9999999999999.99")
_MONEY_QUANTUM = Decimal("0.01")


_WHITESPACE = re.compile(r"\s+")
_REQUIRED_FIELDS = frozenset(
    {
        "event_id",
        "action",
        "job_id",
        "company_id",
        "title",
        "description",
        "skills",
        "location",
        "status",
        "occurred_at",
    }
)
_OPTIONAL_FIELDS = frozenset(
    {
        "schema_version",
        "aggregate_version",
        "requirements",
        "salary_min",
        "salary_max",
        "job_type",
    }
)
_CAMEL_CASE_ENVELOPE_FIELDS = frozenset(
    {"eventId", "eventType", "occurredAt", "payload"}
)
_ALLOWED_STATUSES = {
    JobEventAction.CREATED: frozenset({JobStatus.DRAFT}),
    JobEventAction.UPDATED: frozenset(
        {
            JobStatus.DRAFT,
            JobStatus.PENDING_APPROVAL,
            JobStatus.PUBLISHED,
        }
    ),
    JobEventAction.CLOSED: frozenset({JobStatus.CLOSED}),
    JobEventAction.EXPIRED: frozenset({JobStatus.EXPIRED}),
}


def parse_job_event(
    payload: bytes | str | Mapping[str, object],
    *,
    message_key: bytes | str | None,
) -> JobEvent:
    """Parse the current flat snake_case ``job-events`` contract."""

    data = _load_payload(payload)
    _validate_shape(data)

    event_id = _uuid(_required(data, "event_id"), "event_id")
    action = _enum(
        _required(data, "action"),
        JobEventAction,
        "action",
    )
    job_id = _uuid(_required(data, "job_id"), "job_id")
    company_id = _uuid(_required(data, "company_id"), "company_id")
    title = _text(_required(data, "title"), "title")
    description = _text(
        _required(data, "description"),
        "description",
    )
    skills = _skills(_required(data, "skills"))
    location = _text(_required(data, "location"), "location")
    status = _enum(_required(data, "status"), JobStatus, "status")
    occurred_at = _occurred_at(_required(data, "occurred_at"))
    schema_version = _schema_version(data.get("schema_version"))
    aggregate_version = _optional_non_negative_integer(
        data.get("aggregate_version"),
        "aggregate_version",
    )
    requirements = _optional_text(data.get("requirements"), "requirements")
    salary_min = _optional_money(data.get("salary_min"), "salary_min")
    salary_max = _optional_money(data.get("salary_max"), "salary_max")
    job_type = _optional_enum(data.get("job_type"), JobType, "job_type")

    _validate_message_key(message_key, job_id)
    if status not in _ALLOWED_STATUSES[action]:
        raise JobEventContractError(
            "JOB_EVENT_ACTION_STATUS_MISMATCH",
            "Job event action and status are inconsistent",
            field="status",
        )
    if salary_min is not None and salary_max is not None and salary_max < salary_min:
        raise JobEventContractError(
            "INVALID_JOB_EVENT",
            "Job event salary range is invalid",
            field="salary_max",
        )

    return JobEvent(
        event_id=event_id,
        action=action,
        job_id=job_id,
        company_id=company_id,
        title=title,
        description=description,
        skills=skills,
        location=location,
        status=status,
        occurred_at=occurred_at,
        schema_version=schema_version,
        aggregate_version=aggregate_version,
        requirements=requirements,
        salary_min=salary_min,
        salary_max=salary_max,
        job_type=job_type,
    )


def build_job_embedding_document(event: JobEvent) -> JobEmbeddingDocument:
    """Build deterministic text without retaining the original Kafka payload."""

    sections = [
        f"title: {event.title}",
        f"description: {event.description}",
    ]
    if event.requirements is not None:
        sections.append(f"requirements: {event.requirements}")
    sections.append(f"skills: {', '.join(event.skills)}")
    text = "\n".join(sections)
    return JobEmbeddingDocument(
        text=text,
        text_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


def _load_payload(
    payload: bytes | str | Mapping[str, object],
) -> dict[str, object]:
    if isinstance(payload, Mapping):
        if not all(isinstance(key, str) for key in payload):
            raise _invalid_payload()
        return dict(payload)

    if not isinstance(payload, bytes | str):
        raise _invalid_payload()

    try:
        serialized = payload.decode("utf-8") if isinstance(payload, bytes) else payload
        parsed = json.loads(
            serialized,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, _DuplicateJsonKey):
        raise JobEventContractError(
            "INVALID_JOB_EVENT_JSON",
            "Job event payload is not valid JSON",
        ) from None
    if not isinstance(parsed, dict):
        raise _invalid_payload()
    return cast(dict[str, object], parsed)


def _validate_shape(data: dict[str, object]) -> None:
    if _CAMEL_CASE_ENVELOPE_FIELDS.intersection(data):
        raise JobEventContractError(
            "UNSUPPORTED_JOB_EVENT_ENVELOPE",
            "CamelCase Job event envelopes are not supported",
        )
    missing = _REQUIRED_FIELDS.difference(data)
    if missing:
        raise JobEventContractError(
            "INVALID_JOB_EVENT",
            "A required Job event field is missing",
            field=sorted(missing)[0],
        )
    unknown = set(data).difference(_REQUIRED_FIELDS | _OPTIONAL_FIELDS)
    if unknown:
        raise JobEventContractError(
            "INVALID_JOB_EVENT",
            "Job event contains an unsupported field",
            field="payload",
        )


def _required(data: dict[str, object], field: str) -> object:
    return data[field]


def _uuid(value: object, field: str) -> UUID:
    if not isinstance(value, str):
        raise _invalid_field(field)
    try:
        return UUID(value)
    except ValueError:
        raise _invalid_field(field) from None


def _enum(
    value: object,
    enum_type: type[_EnumType],
    field: str,
) -> _EnumType:
    if not isinstance(value, str):
        raise _invalid_field(field)
    try:
        return enum_type(value)
    except ValueError:
        raise _invalid_field(field) from None


def _optional_enum(
    value: object,
    enum_type: type[_EnumType],
    field: str,
) -> _EnumType | None:
    return None if value is None else _enum(value, enum_type, field)


def _text(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise _invalid_field(field)
    normalized = _normalize_whitespace(value)
    if not normalized:
        raise _invalid_field(field)
    return normalized


def _optional_text(value: object, field: str) -> str | None:
    return None if value is None else _text(value, field)


def _skills(value: object) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise _invalid_field("skills")
    normalized: set[str] = set()
    for skill in value:
        normalized.add(_text(skill, "skills").casefold())
    return tuple(sorted(normalized))


def _occurred_at(value: object) -> datetime:
    if not isinstance(value, str):
        raise _invalid_field("occurred_at")
    serialized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        occurred_at = datetime.fromisoformat(serialized)
    except ValueError:
        raise _invalid_field("occurred_at") from None
    if occurred_at.tzinfo is None or occurred_at.utcoffset() is None:
        raise _invalid_field("occurred_at")
    return occurred_at.astimezone(UTC)


def _schema_version(value: object) -> int:
    if value is None:
        return 1
    version = _non_negative_integer(value, "schema_version")
    if version != 1:
        raise JobEventContractError(
            "UNSUPPORTED_JOB_EVENT_SCHEMA",
            "Job event schema version is not supported",
            field="schema_version",
        )
    return version


def _optional_non_negative_integer(value: object, field: str) -> int | None:
    if value is None:
        return None
    number = _non_negative_integer(value, field)
    if number > _MAX_BIGINT:
        raise _invalid_field(field)
    return number


def _non_negative_integer(value: object, field: str) -> int:
    if type(value) is not int or value < 0:
        raise _invalid_field(field)
    return value


def _optional_money(value: object, field: str) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, str | int | float | Decimal):
        raise _invalid_field(field)
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        raise _invalid_field(field) from None
    if not amount.is_finite() or amount < 0:
        raise _invalid_field(field)
    if amount > _MAX_MONEY:
        raise _invalid_field(field)
    rounded = amount.quantize(_MONEY_QUANTUM)
    if amount != rounded:
        raise _invalid_field(field)
    return amount


def _validate_message_key(message_key: bytes | str | None, job_id: UUID) -> None:
    if not isinstance(message_key, bytes | str):
        raise JobEventContractError(
            "INVALID_JOB_EVENT_KEY",
            "Job event Kafka key is required",
            field="message_key",
        )
    try:
        key = (
            message_key.decode("utf-8")
            if isinstance(message_key, bytes)
            else message_key
        )
        key_id = UUID(key)
    except (UnicodeDecodeError, ValueError):
        raise JobEventContractError(
            "INVALID_JOB_EVENT_KEY",
            "Job event Kafka key is invalid",
            field="message_key",
        ) from None
    if key_id != job_id:
        raise JobEventContractError(
            "JOB_EVENT_KEY_MISMATCH",
            "Job event Kafka key does not match job_id",
            field="message_key",
        )


def _normalize_whitespace(value: str) -> str:
    return _WHITESPACE.sub(" ", unicodedata.normalize("NFKC", value)).strip()


class _DuplicateJsonKey(ValueError):
    pass


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateJsonKey
        result[key] = value
    return result


def _reject_json_constant(_: str) -> NoReturn:
    raise _DuplicateJsonKey


def _invalid_payload() -> JobEventContractError:
    return JobEventContractError(
        "INVALID_JOB_EVENT",
        "Job event payload must be a JSON object",
    )


def _invalid_field(field: str) -> JobEventContractError:
    return JobEventContractError(
        "INVALID_JOB_EVENT",
        "Job event field is invalid",
        field=field,
    )


__all__ = [
    "JobEmbeddingDocument",
    "JobEvent",
    "JobEventAction",
    "JobEventContractError",
    "JobStatus",
    "JobType",
    "build_job_embedding_document",
    "parse_job_event",
]
