"""Real Kafka/PostgreSQL coverage for CV terminal ordering and privacy."""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from threading import Event, Thread
from uuid import UUID, uuid4

import psycopg
import pytest
from confluent_kafka import Consumer, KafkaException, Producer, TopicPartition
from confluent_kafka.admin import AdminClient, NewTopic

from app.cv_ingestion import CvEventProcessor
from app.cv_parser import CvEmbeddingDocument
from app.ingestion_repository import PsycopgIngestionRepository
from app.job_ingestion import PsycopgDeadLetterAdapter
from app.kafka_worker import KafkaEventWorker, create_confluent_consumer
from app.media_client import MediaCvSourceRejected

pytestmark = pytest.mark.integration

CV_ID = UUID("22222222-2222-4222-8222-222222222222")
MISSING_CV_ID = UUID("55555555-5555-4555-8555-555555555555")
CANDIDATE_ID = UUID("33333333-3333-4333-8333-333333333333")
FILE_ID = UUID("44444444-4444-4444-8444-444444444444")
MISSING_FILE_ID = UUID("66666666-6666-4666-8666-666666666666")
PRIVATE_MALFORMED = b'{"private_cv_text":"never-store"'
PRIVATE_OVERSIZED = b'{"private_cv_text":"' + (b"x" * (64 * 1024)) + b'"}'
VECTOR = (1.0,) + (0.0,) * 383


@dataclass
class FakeMedia:
    calls: list[UUID] = field(default_factory=list)

    def fetch_pdf(self, file_id: UUID, _candidate_id: UUID) -> bytes:
        self.calls.append(file_id)
        if file_id == MISSING_FILE_ID:
            raise MediaCvSourceRejected("CV_SOURCE_UNAVAILABLE")
        return b"%PDF-ephemeral"


class FakeParser:
    def extract(self, _payload: bytes) -> CvEmbeddingDocument:
        return CvEmbeddingDocument("Python PostgreSQL", "a" * 64)


class FakeEmbedding:
    @property
    def model_name(self) -> str:
        return "integration/cv-model@revision"

    @property
    def dimension(self) -> int:
        return 384

    def embed(self, _text: str):
        return VECTOR


@pytest.fixture
def kafka_brokers() -> str:
    brokers = os.getenv("AI_TEST_KAFKA_BROKERS", "").strip()
    if not brokers:
        pytest.skip("AI_TEST_KAFKA_BROKERS is required")
    return brokers


@pytest.fixture
def kafka_topic(kafka_brokers: str) -> Iterator[str]:
    topic = f"cv-events-it-{uuid4().hex}"
    admin = AdminClient({"bootstrap.servers": kafka_brokers})
    admin.create_topics([NewTopic(topic, num_partitions=1, replication_factor=1)])[
        topic
    ].result(timeout=15)
    yield topic
    try:
        admin.delete_topics([topic])[topic].result(timeout=15)
    except KafkaException:
        pass


def test_cv_kafka_soft_retention_and_missing_source_do_not_block_delete(
    database_url: str,
    kafka_brokers: str,
    kafka_topic: str,
) -> None:
    repository = PsycopgIngestionRepository(database_url)
    media = FakeMedia()
    group = f"ai-cv-it-{uuid4().hex}"
    worker = KafkaEventWorker(
        consumer=create_confluent_consumer(
            {
                "bootstrap.servers": kafka_brokers,
                "group.id": group,
                "auto.offset.reset": "earliest",
            }
        ),
        topics=[kafka_topic],
        processor=CvEventProcessor(
            topic=kafka_topic,
            embedding_provider=FakeEmbedding(),
            repository=repository,
            media_source=media,
            text_extractor=FakeParser(),
        ),
        dead_letters=PsycopgDeadLetterAdapter(repository),
        max_attempts=1,
        retry_backoff_seconds=0,
        poll_timeout_seconds=0.1,
    )
    producer = Producer({"bootstrap.servers": kafka_brokers})
    positions = [
        publish(producer, kafka_topic, event(1, CV_ID, FILE_ID, "UPSERTED", 1)),
        publish(producer, kafka_topic, event(2, CV_ID, FILE_ID, "DEACTIVATED", 2)),
        publish(
            producer,
            kafka_topic,
            event(3, MISSING_CV_ID, MISSING_FILE_ID, "UPSERTED", 1),
        ),
        publish(
            producer,
            kafka_topic,
            event(4, MISSING_CV_ID, MISSING_FILE_ID, "DELETED", 2),
        ),
        publish(producer, kafka_topic, PRIVATE_MALFORMED, key=CV_ID.bytes),
        publish(producer, kafka_topic, PRIVATE_OVERSIZED, key=str(CV_ID).encode()),
    ]

    stop = Event()
    errors: list[Exception] = []

    def run() -> None:
        try:
            worker.run(stop)
        except Exception as error:
            errors.append(error)

    thread = Thread(target=run, daemon=True)
    thread.start()
    try:
        wait_for_results(database_url, kafka_topic, errors)
    finally:
        stop.set()
        thread.join(timeout=10)

    assert errors == []
    assert not thread.is_alive()
    assert media.calls == [FILE_ID, MISSING_FILE_ID]
    with psycopg.connect(database_url) as connection:
        retained = connection.execute(
            """
            SELECT is_active, vector_dims(vector)
            FROM ai.cv_embeddings WHERE cv_id=%s
            """,
            (CV_ID,),
        ).fetchone()
        missing = connection.execute(
            "SELECT count(*) FROM ai.cv_embeddings WHERE cv_id=%s",
            (MISSING_CV_ID,),
        ).fetchone()
        dead_letters = connection.execute(
            """
            SELECT event_id, aggregate_type, error_code, payload_hash
            FROM ai.embedding_dead_letters ORDER BY id
            """
        ).fetchall()
    assert retained == (False, 384)
    assert missing == (0,)
    assert dead_letters[0][1:] == (
        "CV",
        "CV_SOURCE_UNAVAILABLE",
        dead_letters[0][3],
    )
    assert dead_letters[1] == (
        None,
        None,
        "INVALID_CV_EVENT_JSON",
        hashlib.sha256(PRIVATE_MALFORMED).hexdigest(),
    )
    assert dead_letters[2] == (
        None,
        None,
        "CV_EVENT_PAYLOAD_TOO_LARGE",
        hashlib.sha256(PRIVATE_OVERSIZED).hexdigest(),
    )
    persisted_text = " ".join(str(value) for row in dead_letters for value in row)
    assert "private_cv_text" not in persisted_text
    assert_committed(kafka_brokers, group, kafka_topic, positions[-1])


def event(
    sequence: int,
    cv_id: UUID,
    file_id: UUID,
    action: str,
    version: int,
) -> bytes:
    return json.dumps(
        {
            "event_id": str(UUID(f"10000000-0000-4000-8000-{sequence:012d}")),
            "action": action,
            "cv_id": str(cv_id),
            "candidate_id": str(CANDIDATE_ID),
            "file_id": str(file_id),
            "cv_type": "UPLOAD",
            "occurred_at": f"2026-08-28T01:00:{sequence:02d}.000Z",
            "schema_version": 1,
            "aggregate_version": version,
        },
        separators=(",", ":"),
    ).encode()


def publish(
    producer: Producer,
    topic: str,
    payload: bytes,
    *,
    key: bytes | None = None,
) -> tuple[int, int]:
    parsed = (
        json.loads(payload)
        if payload not in {PRIVATE_MALFORMED, PRIVATE_OVERSIZED}
        else None
    )
    actual_key = key or str(parsed["cv_id"]).encode()
    positions: list[tuple[int, int]] = []
    producer.produce(
        topic,
        partition=0,
        key=actual_key,
        value=payload,
        on_delivery=lambda error, message: positions.append(
            (message.partition(), message.offset())
        )
        if error is None
        else None,
    )
    assert producer.flush(timeout=10) == 0
    assert len(positions) == 1
    return positions[0]


def wait_for_results(database_url: str, topic: str, errors: list[Exception]) -> None:
    deadline = time.monotonic() + 20
    with psycopg.connect(database_url, autocommit=True) as connection:
        while time.monotonic() < deadline:
            if errors:
                raise errors[0]
            counts = connection.execute(
                """
                SELECT
                    (SELECT count(*) FROM ai.embedding_event_ledger
                        WHERE aggregate_type='CV'),
                    (SELECT count(*) FROM ai.embedding_dead_letters WHERE topic=%s)
                """,
                (topic,),
            ).fetchone()
            if counts == (4, 3):
                return
            time.sleep(0.1)
    raise AssertionError("CV Kafka ingestion timed out")


def assert_committed(
    brokers: str,
    group: str,
    topic: str,
    position: tuple[int, int],
) -> None:
    verifier = Consumer(
        {"bootstrap.servers": brokers, "group.id": group, "enable.auto.commit": False}
    )
    try:
        committed = verifier.committed([TopicPartition(topic, 0)], timeout=10)[0]
    finally:
        verifier.close()
    assert committed.offset == position[1] + 1
