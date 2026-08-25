"""Concrete, privacy-safe ingestion adapters for Job Kafka events."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal

from app.embedding import EmbeddingProvider, EmbeddingProviderError
from app.ingestion_repository import (
    IngestionContractError,
    IngestionEvent,
    IngestionRepositoryUnavailable,
    JobDeactivation,
    JobEmbeddingWrite,
    PsycopgIngestionRepository,
)
from app.job_events import (
    JobEmbeddingDocument,
    JobEvent,
    JobEventContractError,
    build_job_embedding_document,
    parse_job_event,
)
from app.kafka_worker import (
    ConsumedRecord,
    DeadLetterRecord,
    RejectEvent,
    RetryableProcessingError,
)

_AGGREGATE_TYPE = "JOB"
_REPOSITORY_CONTRACT_ERROR = "JOB_INGESTION_CONTRACT_ERROR"
_REPOSITORY_UNAVAILABLE_MESSAGE = "job ingestion repository unavailable"


class JobEventProcessor:
    """Turn one configured Job topic into durable embedding state."""

    def __init__(
        self,
        *,
        topic: str,
        embedding_provider: EmbeddingProvider,
        repository: PsycopgIngestionRepository,
    ) -> None:
        if not isinstance(topic, str) or not topic.strip():
            raise ValueError("topic must not be blank")
        self._topic = topic.strip()
        self._embedding_provider = embedding_provider
        self._repository = repository

    def process(self, record: ConsumedRecord) -> None:
        """Persist a terminal outcome or raise a worker-safe error."""

        try:
            self._process(record)
        except JobEventContractError as error:
            raise RejectEvent(error.code) from None
        except IngestionContractError:
            raise RejectEvent(_REPOSITORY_CONTRACT_ERROR) from None
        except IngestionRepositoryUnavailable:
            raise RetryableProcessingError(_REPOSITORY_UNAVAILABLE_MESSAGE) from None
        except EmbeddingProviderError:
            raise RetryableProcessingError(
                "job embedding provider unavailable"
            ) from None

    def _process(self, record: ConsumedRecord) -> None:
        _validate_transport(record, expected_topic=self._topic)
        event = parse_job_event(record.value, message_key=record.key)
        payload_hash = _job_payload_hash(event)

        # This lookup deliberately precedes document construction and model inference.
        if self._repository.lookup_event(event.event_id, payload_hash) is not None:
            return

        if not event.is_active:
            ingestion_event = _ingestion_event(
                event,
                record,
                payload_hash=payload_hash,
                state_hash=_inactive_state_hash(event),
            )
            self._repository.deactivate_job(
                JobDeactivation(
                    event=ingestion_event,
                    job_id=event.job_id,
                    tombstone=False,
                )
            )
            return

        document = build_job_embedding_document(event)
        vector = self._embedding_provider.embed(document.text)
        model_name = self._embedding_provider.model_name
        ingestion_event = _ingestion_event(
            event,
            record,
            payload_hash=payload_hash,
            state_hash=_published_state_hash(
                event,
                document,
                model_name=model_name,
            ),
        )
        self._repository.upsert_job(
            JobEmbeddingWrite(
                event=ingestion_event,
                job_id=event.job_id,
                vector=vector,
                text_hash=document.text_hash,
                model_name=model_name,
                location=event.location,
                salary_min=event.salary_min,
                salary_max=event.salary_max,
                job_type=event.job_type.value if event.job_type is not None else None,
                is_active=True,
            )
        )


class PsycopgDeadLetterAdapter:
    """Store only Kafka transport hashes from the worker dead-letter record."""

    def __init__(self, repository: PsycopgIngestionRepository) -> None:
        self._repository = repository

    def record(self, dead_letter: DeadLetterRecord) -> None:
        try:
            self._repository.record_transport_dead_letter(
                topic=dead_letter.topic,
                partition=dead_letter.partition,
                offset=dead_letter.offset,
                key_hash=dead_letter.key_sha256,
                payload_hash=dead_letter.payload_sha256,
                error_code=dead_letter.error_code,
                attempt_count=dead_letter.attempts,
            )
        except IngestionContractError:
            raise RejectEvent("JOB_DEAD_LETTER_CONTRACT_ERROR") from None
        except IngestionRepositoryUnavailable:
            raise RetryableProcessingError(_REPOSITORY_UNAVAILABLE_MESSAGE) from None


def _validate_transport(record: ConsumedRecord, *, expected_topic: str) -> None:
    if record.topic != expected_topic:
        raise RejectEvent("UNEXPECTED_JOB_EVENT_TOPIC")
    if type(record.partition) is not int or record.partition < 0:
        raise RejectEvent("INVALID_JOB_EVENT_TRANSPORT")
    if type(record.offset) is not int or record.offset < 0:
        raise RejectEvent("INVALID_JOB_EVENT_TRANSPORT")


def _ingestion_event(
    event: JobEvent,
    record: ConsumedRecord,
    *,
    payload_hash: str,
    state_hash: str,
) -> IngestionEvent:
    return IngestionEvent(
        event_id=event.event_id,
        topic=record.topic,
        partition=record.partition,
        offset=record.offset,
        aggregate_type=_AGGREGATE_TYPE,
        aggregate_id=event.job_id,
        action=event.action.value,
        occurred_at=event.occurred_at,
        payload_hash=payload_hash,
        state_hash=state_hash,
        schema_version=event.schema_version,
        aggregate_version=event.aggregate_version,
    )


def _job_payload_hash(event: JobEvent) -> str:
    return _canonical_hash(
        {
            "action": event.action.value,
            "aggregate_version": event.aggregate_version,
            "company_id": str(event.company_id),
            "description": event.description,
            "event_id": str(event.event_id),
            "job_id": str(event.job_id),
            "job_type": event.job_type.value if event.job_type is not None else None,
            "location": event.location,
            "occurred_at": _canonical_timestamp(event.occurred_at),
            "requirements": event.requirements,
            "salary_max": _canonical_decimal(event.salary_max),
            "salary_min": _canonical_decimal(event.salary_min),
            "schema_version": event.schema_version,
            "skills": list(event.skills),
            "status": event.status.value,
            "title": event.title,
        }
    )


def _inactive_state_hash(event: JobEvent) -> str:
    return _canonical_hash(
        {
            "is_active": False,
            "job_id": str(event.job_id),
            "tombstone": False,
        }
    )


def _published_state_hash(
    event: JobEvent,
    document: JobEmbeddingDocument,
    *,
    model_name: str,
) -> str:
    return _canonical_hash(
        {
            "is_active": True,
            "job_id": str(event.job_id),
            "job_type": event.job_type.value if event.job_type is not None else None,
            "location": event.location,
            "model_name": model_name,
            "salary_max": _canonical_decimal(event.salary_max),
            "salary_min": _canonical_decimal(event.salary_min),
            "text_hash": document.text_hash,
        }
    )


def _canonical_hash(value: dict[str, object]) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _canonical_timestamp(value: datetime) -> str:
    return (
        value.astimezone(UTC)
        .isoformat(timespec="microseconds")
        .replace(
            "+00:00",
            "Z",
        )
    )


def _canonical_decimal(value: Decimal | None) -> str | None:
    if value is None:
        return None
    parts = value.as_tuple()
    digits = list(parts.digits)
    exponent = int(parts.exponent)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    if not any(digits):
        return "0"
    coefficient = "".join(str(digit) for digit in digits)
    sign = "-" if parts.sign else ""
    return f"{sign}{coefficient}e{exponent}"


__all__ = ["JobEventProcessor", "PsycopgDeadLetterAdapter"]
