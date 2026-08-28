from __future__ import annotations

import json
from dataclasses import dataclass, field
from uuid import UUID

import pytest

from app.cv_ingestion import CvEventProcessor
from app.cv_parser import CvEmbeddingDocument, CvPdfRejected
from app.ingestion_repository import (
    CvDeactivation,
    CvEmbeddingWrite,
    IngestionOutcome,
    IngestionRepositoryUnavailable,
)
from app.kafka_worker import ConsumedRecord, RejectEvent, RetryableProcessingError
from app.media_client import MediaClientUnavailable, MediaCvSourceRejected

EVENT_ID = "11111111-1111-4111-8111-111111111111"
CV_ID = "22222222-2222-4222-8222-222222222222"
CANDIDATE_ID = "33333333-3333-4333-8333-333333333333"
FILE_ID = "44444444-4444-4444-8444-444444444444"
VECTOR = (1.0,) + (0.0,) * 383
PAYLOAD = {
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


@dataclass
class FakeRepository:
    calls: list[str]
    lookup_result: IngestionOutcome | None = None
    writes: list[CvEmbeddingWrite] = field(default_factory=list)
    deactivations: list[CvDeactivation] = field(default_factory=list)
    dead_letters: list[dict[str, object]] = field(default_factory=list)
    error: Exception | None = None

    def lookup_event(self, _event_id: UUID, _payload_hash: str):
        self.calls.append("lookup")
        if self.error:
            raise self.error
        return self.lookup_result

    def upsert_cv(self, write: CvEmbeddingWrite):
        self.calls.append("upsert")
        self.writes.append(write)
        return IngestionOutcome.APPLIED

    def deactivate_cv(self, command: CvDeactivation):
        self.calls.append("deactivate")
        self.deactivations.append(command)
        return IngestionOutcome.APPLIED

    def dead_letter_cv(self, event, cv_id, candidate_id, **details):
        self.calls.append("dead_letter")
        self.dead_letters.append(
            {
                "event": event,
                "cv_id": cv_id,
                "candidate_id": candidate_id,
                **details,
            }
        )
        return IngestionOutcome.DEAD_LETTER


@dataclass
class FakeMedia:
    calls: list[str]
    error: Exception | None = None

    def fetch_pdf(self, file_id: UUID, candidate_id: UUID) -> bytes:
        self.calls.append("media")
        assert file_id == UUID(FILE_ID)
        assert candidate_id == UUID(CANDIDATE_ID)
        if self.error:
            raise self.error
        return b"%PDF-private-never-persist"


@dataclass
class FakeExtractor:
    calls: list[str]
    error: Exception | None = None

    def extract(self, payload: bytes) -> CvEmbeddingDocument:
        self.calls.append("parse")
        assert payload.startswith(b"%PDF-")
        if self.error:
            raise self.error
        return CvEmbeddingDocument("Backend Python PostgreSQL", "a" * 64)


@dataclass
class FakeEmbedding:
    calls: list[str]

    @property
    def model_name(self) -> str:
        return "test-model@revision"

    @property
    def dimension(self) -> int:
        return 384

    def embed(self, text: str):
        self.calls.append("embed")
        assert text == "Backend Python PostgreSQL"
        return VECTOR


def test_upsert_lookup_precedes_media_parser_inference_and_atomic_write() -> None:
    calls: list[str] = []
    repository = FakeRepository(calls)
    processor(repository, calls=calls).process(record())

    assert calls == ["lookup", "media", "parse", "embed", "upsert"]
    write = repository.writes[0]
    assert write.cv_id == UUID(CV_ID)
    assert write.candidate_id == UUID(CANDIDATE_ID)
    assert write.text_hash == "a" * 64
    assert write.vector == VECTOR
    assert write.event.aggregate_type == "CV"
    assert write.event.aggregate_version == 7


@pytest.mark.parametrize(
    ("action", "tombstone"),
    [("DEACTIVATED", False), ("DELETED", True)],
)
def test_terminal_actions_never_fetch_source(action: str, tombstone: bool) -> None:
    calls: list[str] = []
    repository = FakeRepository(calls)
    processor(repository, calls=calls).process(record(action=action))

    assert calls == ["lookup", "deactivate"]
    assert repository.deactivations[0].candidate_id == UUID(CANDIDATE_ID)
    assert repository.deactivations[0].tombstone is tombstone


def test_terminal_lookup_skips_all_expensive_work() -> None:
    calls: list[str] = []
    repository = FakeRepository(calls, lookup_result=IngestionOutcome.APPLIED)
    processor(repository, calls=calls).process(record())
    assert calls == ["lookup"]


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (MediaCvSourceRejected("CV_SOURCE_UNAVAILABLE"), "CV_SOURCE_UNAVAILABLE"),
        (CvPdfRejected("CV_PDF_TEXT_EMPTY"), "CV_PDF_TEXT_EMPTY"),
        (CvPdfRejected("CV_PDF_RESOURCE_LIMIT"), "CV_PDF_RESOURCE_LIMIT"),
    ],
)
def test_parsed_permanent_failure_writes_terminal_cv_ledger_and_dlq(
    error: Exception,
    code: str,
) -> None:
    calls: list[str] = []
    repository = FakeRepository(calls)
    media_error = error if isinstance(error, MediaCvSourceRejected) else None
    parser_error = error if isinstance(error, CvPdfRejected) else None
    processor(
        repository,
        calls=calls,
        media_error=media_error,
        parser_error=parser_error,
    ).process(record())

    assert calls[-1] == "dead_letter"
    assert repository.dead_letters[0]["error_code"] == code
    assert repository.dead_letters[0]["safe_message"] == code
    assert repository.dead_letters[0]["attempt_count"] == 1
    assert repository.dead_letters[0]["event"].state_hash


def test_transient_media_and_repository_failures_do_not_commit() -> None:
    with pytest.raises(RetryableProcessingError):
        processor(
            FakeRepository([]),
            media_error=MediaClientUnavailable(),
        ).process(record())
    with pytest.raises(RetryableProcessingError):
        processor(
            FakeRepository([], error=IngestionRepositoryUnavailable()),
        ).process(record())


def test_invalid_payload_uses_generic_transport_rejection() -> None:
    bad = record()
    bad = ConsumedRecord(bad.topic, bad.partition, bad.offset, bad.key, b"private")
    with pytest.raises(RejectEvent) as caught:
        processor(FakeRepository([])).process(bad)
    assert caught.value.error_code == "INVALID_CV_EVENT_JSON"


def processor(
    repository: FakeRepository,
    *,
    calls: list[str] | None = None,
    media_error: Exception | None = None,
    parser_error: Exception | None = None,
) -> CvEventProcessor:
    shared = calls if calls is not None else []
    return CvEventProcessor(
        topic="cv-events",
        repository=repository,  # type: ignore[arg-type]
        media_source=FakeMedia(shared, media_error),
        text_extractor=FakeExtractor(shared, parser_error),
        embedding_provider=FakeEmbedding(shared),
    )


def record(**overrides: object) -> ConsumedRecord:
    payload = {**PAYLOAD, **overrides}
    return ConsumedRecord(
        topic="cv-events",
        partition=2,
        offset=41,
        key=CV_ID.encode(),
        value=json.dumps(payload, separators=(",", ":")).encode(),
    )
