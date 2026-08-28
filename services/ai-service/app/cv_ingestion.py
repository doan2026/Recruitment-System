"""Privacy-safe ingestion adapter for canonical Profile CV events."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from app.cv_events import CvEvent, CvEventAction, CvEventContractError, parse_cv_event
from app.cv_parser import (
    CvEmbeddingDocument,
    CvPdfParserUnavailable,
    CvPdfRejected,
)
from app.embedding import EmbeddingProvider, EmbeddingProviderError
from app.ingestion_repository import (
    CvDeactivation,
    CvEmbeddingWrite,
    IngestionContractError,
    IngestionEvent,
    IngestionRepositoryUnavailable,
    PsycopgIngestionRepository,
)
from app.kafka_worker import ConsumedRecord, RejectEvent, RetryableProcessingError
from app.media_client import (
    MediaClientContractError,
    MediaClientUnavailable,
    MediaCvSourceRejected,
)

_AGGREGATE_TYPE = "CV"


class CvMediaSource(Protocol):
    def fetch_pdf(self, file_id: UUID, candidate_id: UUID) -> bytes: ...


class CvTextExtractor(Protocol):
    def extract(self, payload: bytes) -> CvEmbeddingDocument: ...


class CvEventProcessor:
    def __init__(
        self,
        *,
        topic: str,
        embedding_provider: EmbeddingProvider,
        repository: PsycopgIngestionRepository,
        media_source: CvMediaSource,
        text_extractor: CvTextExtractor,
    ) -> None:
        if not isinstance(topic, str) or not topic.strip():
            raise ValueError("topic must not be blank")
        self._topic = topic.strip()
        self._embedding_provider = embedding_provider
        self._repository = repository
        self._media_source = media_source
        self._text_extractor = text_extractor

    def process(self, record: ConsumedRecord) -> None:
        try:
            self._process(record)
        except CvEventContractError as error:
            raise RejectEvent(error.code) from None
        except IngestionContractError:
            raise RejectEvent("CV_INGESTION_CONTRACT_ERROR") from None
        except IngestionRepositoryUnavailable:
            raise RetryableProcessingError(
                "CV ingestion repository unavailable"
            ) from None
        except (MediaClientUnavailable, MediaClientContractError):
            raise RetryableProcessingError("CV Media source unavailable") from None
        except CvPdfParserUnavailable:
            raise RetryableProcessingError("CV PDF parser unavailable") from None
        except EmbeddingProviderError:
            raise RetryableProcessingError(
                "CV embedding provider unavailable"
            ) from None

    def _process(self, record: ConsumedRecord) -> None:
        _validate_transport(record, expected_topic=self._topic)
        event = parse_cv_event(record.value, message_key=record.key)
        payload_hash = _payload_hash(event)

        if self._repository.lookup_event(event.event_id, payload_hash) is not None:
            return

        if event.action is CvEventAction.DEACTIVATED:
            self._repository.deactivate_cv(
                CvDeactivation(
                    event=_ingestion_event(
                        event,
                        record,
                        payload_hash=payload_hash,
                        state_hash=_inactive_state_hash(event, tombstone=False),
                    ),
                    cv_id=event.cv_id,
                    candidate_id=event.candidate_id,
                    tombstone=False,
                )
            )
            return
        if event.action is CvEventAction.DELETED:
            self._repository.deactivate_cv(
                CvDeactivation(
                    event=_ingestion_event(
                        event,
                        record,
                        payload_hash=payload_hash,
                        state_hash=_inactive_state_hash(event, tombstone=True),
                    ),
                    cv_id=event.cv_id,
                    candidate_id=event.candidate_id,
                    tombstone=True,
                )
            )
            return

        try:
            pdf = self._media_source.fetch_pdf(event.file_id, event.candidate_id)
            document = self._text_extractor.extract(pdf)
        except MediaCvSourceRejected as error:
            self._dead_letter_parsed(event, record, payload_hash, error.code)
            return
        except CvPdfRejected as error:
            self._dead_letter_parsed(event, record, payload_hash, error.code)
            return

        vector = self._embedding_provider.embed(document.text)
        model_name = self._embedding_provider.model_name
        self._repository.upsert_cv(
            CvEmbeddingWrite(
                event=_ingestion_event(
                    event,
                    record,
                    payload_hash=payload_hash,
                    state_hash=_active_state_hash(event, document, model_name),
                ),
                cv_id=event.cv_id,
                candidate_id=event.candidate_id,
                vector=vector,
                text_hash=document.text_hash,
                model_name=model_name,
                is_active=True,
            )
        )

    def _dead_letter_parsed(
        self,
        event: CvEvent,
        record: ConsumedRecord,
        payload_hash: str,
        error_code: str,
    ) -> None:
        self._repository.dead_letter_cv(
            _ingestion_event(
                event,
                record,
                payload_hash=payload_hash,
                state_hash=_rejected_state_hash(event),
            ),
            event.cv_id,
            event.candidate_id,
            error_code=error_code,
            safe_message=error_code,
            attempt_count=1,
        )


def _validate_transport(record: ConsumedRecord, *, expected_topic: str) -> None:
    if record.topic != expected_topic:
        raise RejectEvent("UNEXPECTED_CV_EVENT_TOPIC")
    if type(record.partition) is not int or record.partition < 0:
        raise RejectEvent("INVALID_CV_EVENT_TRANSPORT")
    if type(record.offset) is not int or record.offset < 0:
        raise RejectEvent("INVALID_CV_EVENT_TRANSPORT")


def _ingestion_event(
    event: CvEvent,
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
        aggregate_id=event.cv_id,
        action=event.action.value,
        occurred_at=event.occurred_at,
        payload_hash=payload_hash,
        state_hash=state_hash,
        schema_version=event.schema_version,
        aggregate_version=event.aggregate_version,
    )


def _payload_hash(event: CvEvent) -> str:
    return _canonical_hash(
        {
            "action": event.action.value,
            "aggregate_version": event.aggregate_version,
            "candidate_id": str(event.candidate_id),
            "cv_id": str(event.cv_id),
            "cv_type": event.cv_type.value,
            "event_id": str(event.event_id),
            "file_id": str(event.file_id),
            "occurred_at": _canonical_timestamp(event.occurred_at),
            "schema_version": event.schema_version,
        }
    )


def _active_state_hash(
    event: CvEvent,
    document: CvEmbeddingDocument,
    model_name: str,
) -> str:
    return _canonical_hash(
        {
            "candidate_id": str(event.candidate_id),
            "cv_id": str(event.cv_id),
            "file_id": str(event.file_id),
            "is_active": True,
            "model_name": model_name,
            "text_hash": document.text_hash,
            "tombstone": False,
        }
    )


def _inactive_state_hash(event: CvEvent, *, tombstone: bool) -> str:
    return _canonical_hash(
        {
            "candidate_id": str(event.candidate_id),
            "cv_id": str(event.cv_id),
            "is_active": False,
            "tombstone": tombstone,
        }
    )


def _rejected_state_hash(event: CvEvent) -> str:
    return _canonical_hash(
        {
            "action": event.action.value,
            "cv_id": str(event.cv_id),
            "rejected": True,
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
        value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    )
