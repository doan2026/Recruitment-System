"""Strict, privacy-minimal contract handling for Profile CV events."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import NoReturn, TypeVar, cast
from uuid import UUID


class CvEventAction(StrEnum):
    UPSERTED = "UPSERTED"
    DEACTIVATED = "DEACTIVATED"
    DELETED = "DELETED"


class CvType(StrEnum):
    UPLOAD = "UPLOAD"
    ONLINE = "ONLINE"


_EnumType = TypeVar("_EnumType", bound=StrEnum)


class CvEventContractError(ValueError):
    """A stable, payload-safe error raised for an invalid CV event."""

    def __init__(self, code: str, *, field: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.field = field


@dataclass(frozen=True, slots=True)
class CvEvent:
    event_id: UUID
    action: CvEventAction
    cv_id: UUID
    candidate_id: UUID
    file_id: UUID
    cv_type: CvType
    occurred_at: datetime
    schema_version: int
    aggregate_version: int


_MAX_BIGINT = 9_223_372_036_854_775_807
_MAX_EVENT_BYTES = 64 * 1024
_CANONICAL_OCCURRED_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
_FIELDS = frozenset(
    {
        "event_id",
        "action",
        "cv_id",
        "candidate_id",
        "file_id",
        "cv_type",
        "occurred_at",
        "schema_version",
        "aggregate_version",
    }
)
_CAMEL_CASE_ENVELOPE_FIELDS = frozenset(
    {"eventId", "eventType", "occurredAt", "payload"}
)


def parse_cv_event(
    payload: bytes | str | Mapping[str, object],
    *,
    message_key: bytes | str | None,
) -> CvEvent:
    data = _load_payload(payload)
    _validate_shape(data)
    event = CvEvent(
        event_id=_uuid(data["event_id"], "event_id"),
        action=_enum(data["action"], CvEventAction, "action"),
        cv_id=_uuid(data["cv_id"], "cv_id"),
        candidate_id=_uuid(data["candidate_id"], "candidate_id"),
        file_id=_uuid(data["file_id"], "file_id"),
        cv_type=_enum(data["cv_type"], CvType, "cv_type"),
        occurred_at=_occurred_at(data["occurred_at"]),
        schema_version=_schema_version(data["schema_version"]),
        aggregate_version=_aggregate_version(data["aggregate_version"]),
    )
    _validate_message_key(message_key, event.cv_id)
    return event


def _load_payload(
    payload: bytes | str | Mapping[str, object],
) -> dict[str, object]:
    if isinstance(payload, Mapping):
        if not all(isinstance(key, str) for key in payload):
            raise _invalid_payload()
        data = dict(payload)
        try:
            serialized = json.dumps(
                data,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
        except (TypeError, ValueError, RecursionError, UnicodeEncodeError):
            raise CvEventContractError("INVALID_CV_EVENT_JSON") from None
        if len(serialized) > _MAX_EVENT_BYTES:
            raise CvEventContractError("CV_EVENT_PAYLOAD_TOO_LARGE")
        return data
    if not isinstance(payload, bytes | str):
        raise _invalid_payload()
    try:
        if isinstance(payload, bytes):
            if len(payload) > _MAX_EVENT_BYTES:
                raise CvEventContractError("CV_EVENT_PAYLOAD_TOO_LARGE")
            serialized = payload.decode("utf-8")
        else:
            if len(payload.encode("utf-8")) > _MAX_EVENT_BYTES:
                raise CvEventContractError("CV_EVENT_PAYLOAD_TOO_LARGE")
            serialized = payload
        parsed = json.loads(
            serialized,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except CvEventContractError:
        raise
    except (
        UnicodeDecodeError,
        UnicodeEncodeError,
        ValueError,
        RecursionError,
    ):
        raise CvEventContractError("INVALID_CV_EVENT_JSON") from None
    if not isinstance(parsed, dict):
        raise _invalid_payload()
    return cast(dict[str, object], parsed)


def _validate_shape(data: dict[str, object]) -> None:
    if _CAMEL_CASE_ENVELOPE_FIELDS.intersection(data):
        raise CvEventContractError("UNSUPPORTED_CV_EVENT_ENVELOPE")
    missing = _FIELDS.difference(data)
    if missing:
        raise CvEventContractError("INVALID_CV_EVENT", field=sorted(missing)[0])
    if set(data) != _FIELDS:
        raise CvEventContractError("INVALID_CV_EVENT", field="payload")


def _uuid(value: object, field: str) -> UUID:
    if not isinstance(value, str):
        raise _invalid_field(field)
    try:
        return UUID(value)
    except ValueError:
        raise _invalid_field(field) from None


def _enum(value: object, enum_type: type[_EnumType], field: str) -> _EnumType:
    if not isinstance(value, str):
        raise _invalid_field(field)
    try:
        return enum_type(value)
    except ValueError:
        raise _invalid_field(field) from None


def _occurred_at(value: object) -> datetime:
    if not isinstance(value, str) or not _CANONICAL_OCCURRED_AT.fullmatch(value):
        raise _invalid_field("occurred_at")
    try:
        occurred_at = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise _invalid_field("occurred_at") from None
    return occurred_at.astimezone(UTC)


def _schema_version(value: object) -> int:
    if type(value) is not int:
        raise _invalid_field("schema_version")
    if value != 1:
        raise CvEventContractError(
            "UNSUPPORTED_CV_EVENT_SCHEMA",
            field="schema_version",
        )
    return value


def _aggregate_version(value: object) -> int:
    if type(value) is not int or value <= 0 or value > _MAX_BIGINT:
        raise _invalid_field("aggregate_version")
    return value


def _validate_message_key(message_key: bytes | str | None, cv_id: UUID) -> None:
    if not isinstance(message_key, bytes | str):
        raise CvEventContractError("INVALID_CV_EVENT_KEY", field="message_key")
    try:
        raw_key = (
            message_key.decode("utf-8")
            if isinstance(message_key, bytes)
            else message_key
        )
        key_id = UUID(raw_key)
    except (UnicodeDecodeError, ValueError):
        raise CvEventContractError(
            "INVALID_CV_EVENT_KEY",
            field="message_key",
        ) from None
    if key_id != cv_id:
        raise CvEventContractError("CV_EVENT_KEY_MISMATCH", field="message_key")


class _DuplicateJsonKey(ValueError):
    pass


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise _DuplicateJsonKey
        value[key] = item
    return value


def _reject_json_constant(_value: str) -> NoReturn:
    raise _DuplicateJsonKey


def _invalid_payload() -> CvEventContractError:
    return CvEventContractError("INVALID_CV_EVENT")


def _invalid_field(field: str) -> CvEventContractError:
    return CvEventContractError("INVALID_CV_EVENT", field=field)
