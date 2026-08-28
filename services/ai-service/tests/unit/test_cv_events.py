from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.cv_events import (
    CvEventAction,
    CvEventContractError,
    CvType,
    parse_cv_event,
)

EVENT_ID = "11111111-1111-4111-8111-111111111111"
CV_ID = "22222222-2222-4222-8222-222222222222"
CANDIDATE_ID = "33333333-3333-4333-8333-333333333333"
FILE_ID = "44444444-4444-4444-8444-444444444444"
CURRENT_EVENT: dict[str, object] = {
    "event_id": EVENT_ID,
    "action": "UPSERTED",
    "cv_id": CV_ID,
    "candidate_id": CANDIDATE_ID,
    "file_id": FILE_ID,
    "cv_type": "UPLOAD",
    "occurred_at": "2026-08-28T01:02:03.000Z",
    "schema_version": 1,
    "aggregate_version": 7,
}


def test_parses_exact_nine_field_contract_and_key() -> None:
    event = parse_cv_event(
        json.dumps(CURRENT_EVENT).encode(),
        message_key=CV_ID.encode(),
    )

    assert event.event_id == UUID(EVENT_ID)
    assert event.action is CvEventAction.UPSERTED
    assert event.cv_id == UUID(CV_ID)
    assert event.candidate_id == UUID(CANDIDATE_ID)
    assert event.file_id == UUID(FILE_ID)
    assert event.cv_type is CvType.UPLOAD
    assert event.occurred_at == datetime(2026, 8, 28, 1, 2, 3, tzinfo=UTC)
    assert event.schema_version == 1
    assert event.aggregate_version == 7
    assert not hasattr(event, "file_url")
    assert not hasattr(event, "content_json")


@pytest.mark.parametrize("action", ["UPSERTED", "DEACTIVATED", "DELETED"])
def test_accepts_all_canonical_actions(action: str) -> None:
    assert parse_current(action=action).action.value == action


@pytest.mark.parametrize("field", ["event_id", "cv_id", "candidate_id", "file_id"])
def test_rejects_invalid_uuid_fields(field: str) -> None:
    assert parse_error(**{field: "not-a-uuid"}).field == field


@pytest.mark.parametrize("version", [0, -1, True, "1", 9_223_372_036_854_775_808])
def test_requires_positive_bigint_aggregate_version(version: object) -> None:
    error = parse_error(aggregate_version=version)
    assert error.code == "INVALID_CV_EVENT"
    assert error.field == "aggregate_version"


@pytest.mark.parametrize("version", [0, 2, True, "1"])
def test_requires_exact_schema_version_one(version: object) -> None:
    error = parse_error(schema_version=version)
    assert error.code in {"INVALID_CV_EVENT", "UNSUPPORTED_CV_EVENT_SCHEMA"}
    assert error.field == "schema_version"


def test_rejects_missing_unknown_and_camel_case_fields() -> None:
    missing = dict(CURRENT_EVENT)
    missing.pop("file_id")
    with pytest.raises(CvEventContractError) as caught:
        parse_cv_event(missing, message_key=CV_ID)
    assert caught.value.field == "file_id"
    assert parse_error(extra="private").field == "payload"
    with pytest.raises(CvEventContractError) as camel:
        parse_cv_event({"eventId": EVENT_ID}, message_key=CV_ID)
    assert camel.value.code == "UNSUPPORTED_CV_EVENT_ENVELOPE"


def test_rejects_duplicate_json_and_key_mismatch_without_echoing_payload() -> None:
    with pytest.raises(CvEventContractError) as duplicate:
        parse_cv_event(
            '{"event_id":"a","event_id":"b"}',
            message_key=CV_ID,
        )
    assert duplicate.value.code == "INVALID_CV_EVENT_JSON"
    error = parse_error(message_key=FILE_ID)
    assert error.code == "CV_EVENT_KEY_MISMATCH"
    assert "private" not in str(error)


def test_rejects_oversized_deep_or_giant_integer_json_without_echoing_payload() -> None:
    oversized = b'{"private":"' + (b"x" * (64 * 1024)) + b'"}'
    with pytest.raises(CvEventContractError) as too_large:
        parse_cv_event(oversized, message_key=CV_ID)
    assert too_large.value.code == "CV_EVENT_PAYLOAD_TOO_LARGE"

    deep = '{"value":' + ("[" * 2_000) + "0" + ("]" * 2_000) + "}"
    with pytest.raises(CvEventContractError) as nested:
        parse_cv_event(deep, message_key=CV_ID)
    assert nested.value.code == "INVALID_CV_EVENT_JSON"

    giant_integer = '{"aggregate_version":' + ("9" * 5_000) + "}"
    with pytest.raises(CvEventContractError) as integer:
        parse_cv_event(giant_integer, message_key=CV_ID)
    assert integer.value.code == "INVALID_CV_EVENT_JSON"
    assert "private" not in str(too_large.value)


@pytest.mark.parametrize(
    "occurred_at",
    [
        "2026-08-28T01:02:03",
        "2026-08-28T01:02:03Z",
        "2026-08-28T01:02:03.00Z",
        "2026-08-28T01:02:03.000000Z",
        "2026-08-28T01:02:03.000+00:00",
        "2026-08-28T08:02:03.000+07:00",
    ],
)
def test_requires_canonical_utc_millisecond_occurred_at(occurred_at: str) -> None:
    assert parse_error(occurred_at=occurred_at).field == "occurred_at"


def parse_current(**overrides: object):
    return parse_cv_event({**CURRENT_EVENT, **overrides}, message_key=CV_ID)


def parse_error(
    *,
    message_key: bytes | str | None = CV_ID,
    **overrides: object,
) -> CvEventContractError:
    with pytest.raises(CvEventContractError) as caught:
        parse_cv_event({**CURRENT_EVENT, **overrides}, message_key=message_key)
    return caught.value
