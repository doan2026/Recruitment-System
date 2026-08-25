"""Unit tests for the concrete Job event ingestion adapters."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest

from app.embedding import EmbeddingProviderError
from app.ingestion_repository import (
    EventIdentityConflict,
    IngestionContractError,
    IngestionOutcome,
    IngestionRepositoryUnavailable,
    JobDeactivation,
    JobEmbeddingWrite,
)
from app.job_ingestion import JobEventProcessor, PsycopgDeadLetterAdapter
from app.kafka_worker import (
    ConsumedRecord,
    DeadLetterRecord,
    RejectEvent,
    RetryableProcessingError,
)

EVENT_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
COMPANY_ID = "33333333-3333-4333-8333-333333333333"
MODEL_NAME = "sentence-transformers/test-model"
VECTOR = (1.0,) + (0.0,) * 383
PUBLISHED_EVENT: dict[str, object] = {
    "event_id": EVENT_ID,
    "action": "UPDATED",
    "job_id": JOB_ID,
    "company_id": COMPANY_ID,
    "title": "Backend Engineer",
    "description": "Build recruitment services",
    "requirements": "APIs and queues",
    "skills": ["SQL", "NestJS", "Python"],
    "location": "Ha Noi",
    "salary_min": "20000000.00",
    "salary_max": 30000000,
    "job_type": "FULL_TIME",
    "status": "PUBLISHED",
    "occurred_at": "2026-08-24T00:00:00.000Z",
    "schema_version": 1,
    "aggregate_version": 7,
}


@dataclass
class FakeEmbeddingProvider:
    calls: list[str]
    error: Exception | None = None
    texts: list[str] = field(default_factory=list)

    @property
    def model_name(self) -> str:
        return MODEL_NAME

    @property
    def dimension(self) -> int:
        return 384

    def embed(self, text: str) -> tuple[float, ...]:
        self.calls.append("embed")
        self.texts.append(text)
        if self.error is not None:
            raise self.error
        return VECTOR


@dataclass
class FakeRepository:
    calls: list[str]
    lookup_result: IngestionOutcome | None = None
    lookup_error: Exception | None = None
    upsert_error: Exception | None = None
    deactivate_error: Exception | None = None
    dead_letter_error: Exception | None = None
    lookups: list[tuple[UUID, str]] = field(default_factory=list)
    writes: list[JobEmbeddingWrite] = field(default_factory=list)
    deactivations: list[JobDeactivation] = field(default_factory=list)
    dead_letters: list[dict[str, object]] = field(default_factory=list)

    def lookup_event(
        self,
        event_id: UUID,
        payload_hash: str,
    ) -> IngestionOutcome | None:
        self.calls.append("lookup")
        self.lookups.append((event_id, payload_hash))
        if self.lookup_error is not None:
            raise self.lookup_error
        return self.lookup_result

    def upsert_job(self, write: JobEmbeddingWrite) -> IngestionOutcome:
        self.calls.append("upsert")
        self.writes.append(write)
        if self.upsert_error is not None:
            raise self.upsert_error
        return IngestionOutcome.APPLIED

    def deactivate_job(self, command: JobDeactivation) -> IngestionOutcome:
        self.calls.append("deactivate")
        self.deactivations.append(command)
        if self.deactivate_error is not None:
            raise self.deactivate_error
        return IngestionOutcome.APPLIED

    def record_transport_dead_letter(
        self,
        *,
        topic: str,
        partition: int,
        offset: int,
        key_hash: str | None,
        payload_hash: str,
        error_code: str,
        attempt_count: int,
        safe_message: str | None = None,
    ) -> IngestionOutcome:
        self.calls.append("dead_letter")
        self.dead_letters.append(
            {
                "topic": topic,
                "partition": partition,
                "offset": offset,
                "key_hash": key_hash,
                "payload_hash": payload_hash,
                "error_code": error_code,
                "attempt_count": attempt_count,
                "safe_message": safe_message,
            }
        )
        if self.dead_letter_error is not None:
            raise self.dead_letter_error
        return IngestionOutcome.DEAD_LETTER


def test_published_event_prechecks_then_embeds_and_upserts_metadata() -> None:
    calls: list[str] = []
    repository = FakeRepository(calls)
    provider = FakeEmbeddingProvider(calls)

    processor(repository, provider).process(consumed_record())

    assert calls == ["lookup", "embed", "upsert"]
    assert provider.texts == [
        "title: Backend Engineer\n"
        "description: Build recruitment services\n"
        "requirements: APIs and queues\n"
        "skills: nestjs, python, sql"
    ]
    assert repository.lookups == [(UUID(EVENT_ID), expected_payload_hash())]
    assert len(repository.writes) == 1
    write = repository.writes[0]
    assert write.job_id == UUID(JOB_ID)
    assert write.vector == VECTOR
    assert write.text_hash == hashlib.sha256(provider.texts[0].encode()).hexdigest()
    assert write.model_name == MODEL_NAME
    assert write.location == "Ha Noi"
    assert write.salary_min == Decimal("20000000.00")
    assert write.salary_max == Decimal("30000000")
    assert write.job_type == "FULL_TIME"
    assert write.is_active is True
    assert write.event.event_id == UUID(EVENT_ID)
    assert write.event.aggregate_type == "JOB"
    assert write.event.aggregate_id == UUID(JOB_ID)
    assert write.event.action == "UPDATED"
    assert write.event.topic == "job-events"
    assert write.event.partition == 2
    assert write.event.offset == 41
    assert write.event.occurred_at == datetime(2026, 8, 24, tzinfo=UTC)
    assert write.event.schema_version == 1
    assert write.event.aggregate_version == 7
    assert write.event.payload_hash == expected_payload_hash()
    assert write.event.state_hash == expected_published_state_hash(write.text_hash)
    assert "Build recruitment services" not in repr(write)


@pytest.mark.parametrize(
    ("action", "status"),
    [
        ("CREATED", "DRAFT"),
        ("UPDATED", "PENDING_APPROVAL"),
        ("CLOSED", "CLOSED"),
        ("EXPIRED", "EXPIRED"),
    ],
)
def test_inactive_event_deactivates_without_model_inference(
    action: str,
    status: str,
) -> None:
    calls: list[str] = []
    repository = FakeRepository(calls)
    provider = FakeEmbeddingProvider(calls)
    payload = event_payload(action=action, status=status)

    processor(repository, provider).process(consumed_record(payload))

    assert calls == ["lookup", "deactivate"]
    assert provider.texts == []
    assert repository.writes == []
    assert len(repository.deactivations) == 1
    command = repository.deactivations[0]
    assert command.job_id == UUID(JOB_ID)
    assert command.tombstone is False
    assert command.event.action == action
    assert command.event.state_hash == canonical_hash(
        {
            "is_active": False,
            "job_id": JOB_ID,
            "tombstone": False,
        }
    )


def test_terminal_duplicate_returns_before_model_or_write() -> None:
    calls: list[str] = []
    repository = FakeRepository(
        calls,
        lookup_result=IngestionOutcome.SKIPPED_DUPLICATE,
    )
    provider = FakeEmbeddingProvider(calls)

    processor(repository, provider).process(consumed_record())

    assert calls == ["lookup"]
    assert provider.texts == []
    assert repository.writes == []
    assert repository.deactivations == []


def test_normalized_equivalent_payloads_have_stable_payload_and_state_hashes() -> None:
    first_calls: list[str] = []
    first_repository = FakeRepository(first_calls)
    processor(
        first_repository,
        FakeEmbeddingProvider(first_calls),
    ).process(consumed_record())

    equivalent = event_payload(
        title="Ｂａｃｋｅｎｄ   Engineer",
        description="Build\nrecruitment\tservices",
        requirements=" APIs\u00a0and  queues ",
        skills=["python", "NestJS", "SQL", "nestjs"],
        location=" Ha\u3000Noi ",
        salary_min=20000000,
        salary_max="30000000.0",
        occurred_at="2026-08-24T07:00:00+07:00",
    )
    second_calls: list[str] = []
    second_repository = FakeRepository(second_calls)
    processor(
        second_repository,
        FakeEmbeddingProvider(second_calls),
    ).process(consumed_record(equivalent))

    assert first_repository.lookups[0][1] == second_repository.lookups[0][1]
    assert (
        first_repository.writes[0].event.state_hash
        == second_repository.writes[0].event.state_hash
    )


@pytest.mark.parametrize(
    ("payload", "record_options", "error_code"),
    [
        (b'{"event_id":', {}, "INVALID_JOB_EVENT_JSON"),
        (
            PUBLISHED_EVENT,
            {"key": b"44444444-4444-4444-8444-444444444444"},
            "JOB_EVENT_KEY_MISMATCH",
        ),
        (
            PUBLISHED_EVENT,
            {"topic": "profile-events"},
            "UNEXPECTED_JOB_EVENT_TOPIC",
        ),
        (PUBLISHED_EVENT, {"partition": -1}, "INVALID_JOB_EVENT_TRANSPORT"),
        (PUBLISHED_EVENT, {"offset": -1}, "INVALID_JOB_EVENT_TRANSPORT"),
    ],
)
def test_contract_and_transport_failures_become_reject_event(
    payload: dict[str, object] | bytes,
    record_options: dict[str, object],
    error_code: str,
) -> None:
    calls: list[str] = []
    repository = FakeRepository(calls)
    provider = FakeEmbeddingProvider(calls)

    with pytest.raises(RejectEvent) as caught:
        processor(repository, provider).process(
            consumed_record(payload, **record_options)
        )

    assert caught.value.error_code == error_code
    assert calls == []


def test_repository_contract_failure_becomes_sanitized_reject() -> None:
    private_message = "private database conflict detail"
    calls: list[str] = []
    repository = FakeRepository(
        calls,
        lookup_error=EventIdentityConflict(private_message),
    )

    with pytest.raises(RejectEvent) as caught:
        processor(repository, FakeEmbeddingProvider(calls)).process(consumed_record())

    assert caught.value.error_code == "JOB_INGESTION_CONTRACT_ERROR"
    assert private_message not in str(caught.value)
    assert calls == ["lookup"]


@pytest.mark.parametrize("failure_stage", ["lookup", "upsert", "deactivate"])
def test_repository_unavailability_is_retryable(failure_stage: str) -> None:
    calls: list[str] = []
    private_message = "postgresql://private-credential"
    options: dict[str, object] = {}
    payload = PUBLISHED_EVENT
    if failure_stage == "lookup":
        options["lookup_error"] = IngestionRepositoryUnavailable(private_message)
    elif failure_stage == "upsert":
        options["upsert_error"] = IngestionRepositoryUnavailable(private_message)
    else:
        options["deactivate_error"] = IngestionRepositoryUnavailable(private_message)
        payload = event_payload(action="CLOSED", status="CLOSED")
    repository = FakeRepository(calls, **options)

    with pytest.raises(RetryableProcessingError) as caught:
        processor(repository, FakeEmbeddingProvider(calls)).process(
            consumed_record(payload)
        )

    assert str(caught.value) == "job ingestion repository unavailable"
    assert private_message not in str(caught.value)


def test_model_failure_is_retryable_and_does_not_write() -> None:
    calls: list[str] = []
    private_message = "private model cache path"
    repository = FakeRepository(calls)
    provider = FakeEmbeddingProvider(
        calls,
        error=EmbeddingProviderError(private_message),
    )

    with pytest.raises(RetryableProcessingError) as caught:
        processor(repository, provider).process(consumed_record())

    assert str(caught.value) == "job embedding provider unavailable"
    assert private_message not in str(caught.value)
    assert calls == ["lookup", "embed"]
    assert repository.writes == []


def test_dead_letter_adapter_forwards_only_sanitized_transport_metadata() -> None:
    calls: list[str] = []
    repository = FakeRepository(calls)
    dead_letter = DeadLetterRecord(
        topic="job-events",
        partition=2,
        offset=41,
        key_sha256="a" * 64,
        payload_sha256="b" * 64,
        error_code="INVALID_JOB_EVENT",
        attempts=3,
        failed_at=datetime(2026, 8, 26, tzinfo=UTC),
    )

    PsycopgDeadLetterAdapter(repository).record(dead_letter)

    assert calls == ["dead_letter"]
    assert repository.dead_letters == [
        {
            "topic": "job-events",
            "partition": 2,
            "offset": 41,
            "key_hash": "a" * 64,
            "payload_hash": "b" * 64,
            "error_code": "INVALID_JOB_EVENT",
            "attempt_count": 3,
            "safe_message": None,
        }
    ]


@pytest.mark.parametrize(
    ("error", "expected_type", "expected_code"),
    [
        (
            IngestionContractError("private contract detail"),
            RejectEvent,
            "JOB_DEAD_LETTER_CONTRACT_ERROR",
        ),
        (
            IngestionRepositoryUnavailable("private database detail"),
            RetryableProcessingError,
            None,
        ),
    ],
)
def test_dead_letter_adapter_maps_repository_failures(
    error: Exception,
    expected_type: type[Exception],
    expected_code: str | None,
) -> None:
    repository = FakeRepository([], dead_letter_error=error)

    with pytest.raises(expected_type) as caught:
        PsycopgDeadLetterAdapter(repository).record(
            DeadLetterRecord(
                topic="job-events",
                partition=0,
                offset=1,
                key_sha256=None,
                payload_sha256="b" * 64,
                error_code="INVALID_JOB_EVENT",
                attempts=3,
                failed_at=datetime(2026, 8, 26, tzinfo=UTC),
            )
        )

    if expected_code is not None:
        assert isinstance(caught.value, RejectEvent)
        assert caught.value.error_code == expected_code
    assert "private" not in str(caught.value)


@pytest.mark.parametrize("topic", ["", "   "])
def test_processor_rejects_blank_configured_topic(topic: str) -> None:
    with pytest.raises(ValueError, match="topic must not be blank"):
        JobEventProcessor(
            topic=topic,
            embedding_provider=FakeEmbeddingProvider([]),
            repository=FakeRepository([]),
        )


def processor(
    repository: FakeRepository,
    provider: FakeEmbeddingProvider,
) -> JobEventProcessor:
    return JobEventProcessor(
        topic="job-events",
        embedding_provider=provider,
        repository=repository,
    )


def consumed_record(
    payload: dict[str, object] | bytes = PUBLISHED_EVENT,
    *,
    topic: str = "job-events",
    partition: int = 2,
    offset: int = 41,
    key: bytes | None = JOB_ID.encode(),
) -> ConsumedRecord:
    value = json.dumps(payload).encode() if isinstance(payload, dict) else payload
    return ConsumedRecord(
        topic=topic,
        partition=partition,
        offset=offset,
        key=key,
        value=value,
    )


def event_payload(**overrides: object) -> dict[str, object]:
    return {**PUBLISHED_EVENT, **overrides}


def expected_payload_hash() -> str:
    return canonical_hash(
        {
            "action": "UPDATED",
            "aggregate_version": 7,
            "company_id": COMPANY_ID,
            "description": "Build recruitment services",
            "event_id": EVENT_ID,
            "job_id": JOB_ID,
            "job_type": "FULL_TIME",
            "location": "Ha Noi",
            "occurred_at": "2026-08-24T00:00:00.000000Z",
            "requirements": "APIs and queues",
            "salary_max": "3e7",
            "salary_min": "2e7",
            "schema_version": 1,
            "skills": ["nestjs", "python", "sql"],
            "status": "PUBLISHED",
            "title": "Backend Engineer",
        }
    )


def expected_published_state_hash(text_hash: str) -> str:
    return canonical_hash(
        {
            "is_active": True,
            "job_id": JOB_ID,
            "job_type": "FULL_TIME",
            "location": "Ha Noi",
            "model_name": MODEL_NAME,
            "salary_max": "3e7",
            "salary_min": "2e7",
            "text_hash": text_hash,
        }
    )


def canonical_hash(value: dict[str, object]) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode()).hexdigest()
