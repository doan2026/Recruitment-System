"""Contract tests for flat snake_case Job Kafka events."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest

from app.job_events import (
    JobEventAction,
    JobEventContractError,
    JobStatus,
    JobType,
    build_job_embedding_document,
    parse_job_event,
)

EVENT_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
COMPANY_ID = "33333333-3333-4333-8333-333333333333"
OTHER_JOB_ID = "44444444-4444-4444-8444-444444444444"
CURRENT_JOB_EVENT: dict[str, object] = {
    "event_id": EVENT_ID,
    "action": "UPDATED",
    "job_id": JOB_ID,
    "company_id": COMPANY_ID,
    "title": "Backend Engineer",
    "description": "Build recruitment services",
    "skills": ["NestJS"],
    "location": "Ha Noi",
    "status": "PUBLISHED",
    "occurred_at": "2026-08-24T00:00:00.000Z",
}


def test_parses_exact_current_job_producer_fixture() -> None:
    event = parse_job_event(
        json.dumps(CURRENT_JOB_EVENT).encode(),
        message_key=JOB_ID.encode(),
    )

    assert event.event_id == UUID(EVENT_ID)
    assert event.action is JobEventAction.UPDATED
    assert event.job_id == UUID(JOB_ID)
    assert event.company_id == UUID(COMPANY_ID)
    assert event.title == "Backend Engineer"
    assert event.description == "Build recruitment services"
    assert event.skills == ("nestjs",)
    assert event.location == "Ha Noi"
    assert event.status is JobStatus.PUBLISHED
    assert event.occurred_at == datetime(2026, 8, 24, tzinfo=UTC)
    assert event.schema_version == 1
    assert event.aggregate_version is None
    assert event.requirements is None
    assert event.salary_min is None
    assert event.salary_max is None
    assert event.job_type is None
    assert event.is_active is True

    document = build_job_embedding_document(event)
    assert document.text == (
        "title: Backend Engineer\n"
        "description: Build recruitment services\n"
        "skills: nestjs"
    )
    assert document.text_hash == (
        "443081eff105dedaa75e43975f6fb6da7d814a51fff0029df04b68cdb471040f"
    )
    assert not hasattr(event, "raw_payload")


def test_accepts_and_types_optional_v1_fields() -> None:
    payload = current_event(
        schema_version=1,
        aggregate_version=0,
        title="  Backend\u3000Engineer  ",
        description=" Build\n recruitment\tservices ",
        requirements="  APIs\u00a0and  queues ",
        skills=[" SQL ", "NestJS", "nestjs", "Ｐｙｔｈｏｎ", "python"],
        location="  Ha\u00a0Noi ",
        salary_min="20000000.00",
        salary_max=30000000,
        job_type="FULL_TIME",
    )

    event = parse_current(payload)

    assert event.schema_version == 1
    assert event.aggregate_version == 0
    assert event.title == "Backend Engineer"
    assert event.description == "Build recruitment services"
    assert event.requirements == "APIs and queues"
    assert event.skills == ("nestjs", "python", "sql")
    assert event.location == "Ha Noi"
    assert event.salary_min == Decimal("20000000.00")
    assert event.salary_max == Decimal("30000000")
    assert event.job_type is JobType.FULL_TIME
    assert build_job_embedding_document(event).text == (
        "title: Backend Engineer\n"
        "description: Build recruitment services\n"
        "requirements: APIs and queues\n"
        "skills: nestjs, python, sql"
    )


def test_normalization_produces_stable_text_and_hash() -> None:
    first = parse_current(
        current_event(
            title="Backend   Engineer",
            description="Build\nrecruitment services",
            skills=["SQL", "NestJS", "nestjs"],
        )
    )
    second = parse_current(
        current_event(
            title="Ｂａｃｋｅｎｄ Engineer",
            description="Build recruitment\tservices",
            skills=["nestjs", "sql"],
        )
    )

    assert build_job_embedding_document(first) == build_job_embedding_document(second)


@pytest.mark.parametrize(
    ("action", "status", "active"),
    [
        ("CREATED", "DRAFT", False),
        ("UPDATED", "DRAFT", False),
        ("UPDATED", "PENDING_APPROVAL", False),
        ("UPDATED", "PUBLISHED", True),
        ("CLOSED", "CLOSED", False),
        ("EXPIRED", "EXPIRED", False),
    ],
)
def test_accepts_current_action_status_pairs(
    action: str,
    status: str,
    active: bool,
) -> None:
    event = parse_current(current_event(action=action, status=status))

    assert event.is_active is active


@pytest.mark.parametrize(
    ("action", "status"),
    [
        ("CREATED", "PUBLISHED"),
        ("UPDATED", "CLOSED"),
        ("UPDATED", "EXPIRED"),
        ("CLOSED", "PUBLISHED"),
        ("EXPIRED", "CLOSED"),
    ],
)
def test_rejects_inconsistent_action_status_pairs(
    action: str,
    status: str,
) -> None:
    error = parse_error(current_event(action=action, status=status))

    assert error.code == "JOB_EVENT_ACTION_STATUS_MISMATCH"
    assert error.field == "status"


@pytest.mark.parametrize("field", ["event_id", "job_id", "company_id"])
def test_rejects_invalid_uuid_fields(field: str) -> None:
    error = parse_error(current_event(**{field: "not-a-uuid"}))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == field


def test_normalizes_timezone_aware_occurred_at_to_utc() -> None:
    event = parse_current(current_event(occurred_at="2026-08-24T07:00:00+07:00"))

    assert event.occurred_at == datetime(2026, 8, 24, tzinfo=UTC)


@pytest.mark.parametrize(
    "occurred_at",
    ["2026-08-24T00:00:00", "not-a-time", 123],
)
def test_rejects_invalid_or_timezone_naive_occurred_at(
    occurred_at: object,
) -> None:
    error = parse_error(current_event(occurred_at=occurred_at))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == "occurred_at"


@pytest.mark.parametrize(
    ("message_key", "code"),
    [
        (None, "INVALID_JOB_EVENT_KEY"),
        (b"\xff", "INVALID_JOB_EVENT_KEY"),
        ("not-a-uuid", "INVALID_JOB_EVENT_KEY"),
        (OTHER_JOB_ID, "JOB_EVENT_KEY_MISMATCH"),
    ],
)
def test_rejects_missing_invalid_or_mismatched_kafka_key(
    message_key: bytes | str | None,
    code: str,
) -> None:
    error = parse_error(CURRENT_JOB_EVENT, message_key=message_key)

    assert error.code == code
    assert error.field == "message_key"


@pytest.mark.parametrize("schema_version", [0, 2])
def test_rejects_unsupported_schema_version(schema_version: int) -> None:
    error = parse_error(current_event(schema_version=schema_version))

    assert error.code == "UNSUPPORTED_JOB_EVENT_SCHEMA"
    assert error.field == "schema_version"


@pytest.mark.parametrize("schema_version", [True, "1", 1.5])
def test_rejects_non_integer_schema_version(schema_version: object) -> None:
    error = parse_error(current_event(schema_version=schema_version))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == "schema_version"


@pytest.mark.parametrize(
    "aggregate_version",
    [
        -1,
        True,
        "1",
        1.5,
        9_223_372_036_854_775_808,
    ],
)
def test_rejects_invalid_aggregate_version(aggregate_version: object) -> None:
    error = parse_error(current_event(aggregate_version=aggregate_version))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == "aggregate_version"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("salary_min", -1),
        ("salary_min", "NaN"),
        ("salary_max", float("inf")),
        ("salary_max", True),
        ("salary_max", "not-money"),
        ("salary_max", "1000000000000.00"),
        ("salary_max", "1.001"),
    ],
)
def test_rejects_invalid_optional_salary(field: str, value: object) -> None:
    error = parse_error(current_event(**{field: value}))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == field


def test_rejects_reversed_salary_range() -> None:
    error = parse_error(current_event(salary_min=20, salary_max=10))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == "salary_max"


def test_rejects_unknown_job_type_without_echoing_value() -> None:
    secret_value = "PRIVATE_UNSUPPORTED_TYPE"
    error = parse_error(current_event(job_type=secret_value))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == "job_type"
    assert secret_value not in str(error)


@pytest.mark.parametrize(
    "skills",
    [[], "NestJS", ["NestJS", "   "], ["NestJS", 1]],
)
def test_rejects_invalid_skills(skills: object) -> None:
    error = parse_error(current_event(skills=skills))

    assert error.code == "INVALID_JOB_EVENT"
    assert error.field == "skills"


def test_rejects_missing_and_unknown_fields() -> None:
    missing = dict(CURRENT_JOB_EVENT)
    missing.pop("title")
    missing_error = parse_error(missing)
    unknown_error = parse_error(current_event(unexpected=True))

    assert missing_error.code == "INVALID_JOB_EVENT"
    assert missing_error.field == "title"
    assert unknown_error.code == "INVALID_JOB_EVENT"
    assert unknown_error.field == "payload"


@pytest.mark.parametrize(
    "camel_field",
    ["eventId", "eventType", "occurredAt", "payload"],
)
def test_does_not_support_camel_case_envelope(camel_field: str) -> None:
    error = parse_error({camel_field: {}})

    assert error.code == "UNSUPPORTED_JOB_EVENT_ENVELOPE"
    assert error.field is None


@pytest.mark.parametrize(
    "payload",
    [
        b'{"event_id":',
        b"\xff",
        b"[]",
        (
            '{"event_id":"11111111-1111-4111-8111-111111111111",'
            '"event_id":"22222222-2222-4222-8222-222222222222"}'
        ),
    ],
)
def test_rejects_malformed_non_object_or_duplicate_json(
    payload: bytes | str,
) -> None:
    with pytest.raises(JobEventContractError) as caught:
        parse_job_event(payload, message_key=JOB_ID)

    assert caught.value.code in {"INVALID_JOB_EVENT", "INVALID_JOB_EVENT_JSON"}


def current_event(**overrides: object) -> dict[str, object]:
    return {**CURRENT_JOB_EVENT, **overrides}


def parse_current(payload: dict[str, object]):
    return parse_job_event(payload, message_key=JOB_ID)


def parse_error(
    payload: dict[str, object],
    *,
    message_key: bytes | str | None = JOB_ID,
) -> JobEventContractError:
    with pytest.raises(JobEventContractError) as caught:
        parse_job_event(payload, message_key=message_key)
    return caught.value
