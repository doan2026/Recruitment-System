"""End-to-end Job ingestion against real Kafka and PostgreSQL/pgvector."""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from threading import Event, Thread
from uuid import UUID, uuid4

import psycopg
import pytest
from confluent_kafka import Consumer, KafkaException, Producer, TopicPartition
from confluent_kafka.admin import AdminClient, NewTopic

from app.ingestion_repository import PsycopgIngestionRepository
from app.job_ingestion import JobEventProcessor, PsycopgDeadLetterAdapter
from app.kafka_worker import KafkaEventWorker, create_confluent_consumer

pytestmark = pytest.mark.integration

EVENT_ID = UUID("11111111-1111-4111-8111-111111111111")
JOB_ID = UUID("22222222-2222-4222-8222-222222222222")
COMPANY_ID = UUID("33333333-3333-4333-8333-333333333333")
MODEL_NAME = "integration/fake-deterministic-384"
MALFORMED_KEY = b"private-malformed-key-never-store"
MALFORMED_PAYLOAD = b'{"private":"never-store","event_id":'


@dataclass
class DeterministicEmbeddingProvider:
    texts: list[str] = field(default_factory=list)

    @property
    def model_name(self) -> str:
        return MODEL_NAME

    @property
    def dimension(self) -> int:
        return 384

    def embed(self, text: str) -> tuple[float, ...]:
        self.texts.append(text)
        digest = hashlib.sha256(text.encode()).digest()
        return tuple((digest[index % len(digest)] + 1) / 256 for index in range(384))


@pytest.fixture
def kafka_brokers() -> str:
    brokers = os.getenv("AI_TEST_KAFKA_BROKERS", "").strip()
    if not brokers:
        pytest.skip("AI_TEST_KAFKA_BROKERS is required for Kafka integration tests")
    return brokers


@pytest.fixture
def kafka_topic(kafka_brokers: str) -> Iterator[str]:
    topic = f"job-events-it-{uuid4().hex}"
    admin = AdminClient({"bootstrap.servers": kafka_brokers})
    admin.create_topics([NewTopic(topic, num_partitions=1, replication_factor=1)])[
        topic
    ].result(timeout=15)
    yield topic
    try:
        admin.delete_topics([topic])[topic].result(timeout=15)
    except KafkaException:
        # The Compose stack is ephemeral; cleanup must not mask test assertions.
        pass


def test_real_kafka_ingestion_is_idempotent_and_dead_letters_only_hashes(
    database_url: str,
    kafka_brokers: str,
    kafka_topic: str,
) -> None:
    repository = PsycopgIngestionRepository(database_url)
    provider = DeterministicEmbeddingProvider()
    group_id = f"ai-job-ingestion-it-{uuid4().hex}"
    consumer = create_confluent_consumer(
        {
            "bootstrap.servers": kafka_brokers,
            "group.id": group_id,
            "auto.offset.reset": "earliest",
        }
    )
    worker = KafkaEventWorker(
        consumer=consumer,
        topics=[kafka_topic],
        processor=JobEventProcessor(
            topic=kafka_topic,
            embedding_provider=provider,
            repository=repository,
        ),
        dead_letters=PsycopgDeadLetterAdapter(repository),
        max_attempts=1,
        retry_backoff_seconds=0,
        poll_timeout_seconds=0.1,
    )

    producer = Producer({"bootstrap.servers": kafka_brokers})
    payload = _published_payload()
    published_position = _publish(
        producer,
        kafka_topic,
        key=str(JOB_ID).encode(),
        value=payload,
    )
    duplicate_position = _publish(
        producer,
        kafka_topic,
        key=str(JOB_ID).encode(),
        value=payload,
    )
    malformed_position = _publish(
        producer,
        kafka_topic,
        key=MALFORMED_KEY,
        value=MALFORMED_PAYLOAD,
    )

    stop_event = Event()
    worker_errors: list[Exception] = []

    def run_worker() -> None:
        try:
            worker.run(stop_event)
        except Exception as error:
            worker_errors.append(error)

    thread = Thread(target=run_worker, name="job-ingestion-kafka-it", daemon=True)
    thread.start()
    try:
        _wait_for_terminal_rows(database_url, kafka_topic, worker_errors)
    finally:
        stop_event.set()
        thread.join(timeout=10)

    assert not thread.is_alive()
    assert worker_errors == []
    assert published_position[0] == duplicate_position[0] == malformed_position[0] == 0
    assert published_position[1] < duplicate_position[1] < malformed_position[1]
    assert len(provider.texts) == 1
    assert "requirements: NestJS, PostgreSQL and Kafka" in provider.texts[0]

    with psycopg.connect(database_url) as connection:
        embedding = connection.execute(
            """
            SELECT vector_dims(vector), text_hash, model_name, location,
                   salary_min, salary_max, job_type, is_active,
                   source_event_id, source_version
            FROM ai.job_embeddings
            WHERE job_id = %s
            """,
            (JOB_ID,),
        ).fetchone()
        ledger = connection.execute(
            """
            SELECT event_id, topic, kafka_partition, kafka_offset, outcome
            FROM ai.embedding_event_ledger
            """
        ).fetchall()
        dead_letters = connection.execute(
            """
            SELECT event_id, topic, kafka_partition, kafka_offset, key_hash,
                   aggregate_type, aggregate_id, action, payload_hash,
                   error_code, error_message, attempt_count
            FROM ai.embedding_dead_letters
            """
        ).fetchall()

    expected_text_hash = hashlib.sha256(provider.texts[0].encode()).hexdigest()
    assert embedding == (
        384,
        expected_text_hash,
        MODEL_NAME,
        "Ha Noi",
        Decimal("9999999999998.45"),
        Decimal("9999999999999.45"),
        "FULL_TIME",
        True,
        EVENT_ID,
        42,
    )
    assert ledger == [
        (EVENT_ID, kafka_topic, *published_position, "APPLIED"),
    ]
    assert dead_letters == [
        (
            None,
            kafka_topic,
            *malformed_position,
            hashlib.sha256(MALFORMED_KEY).hexdigest(),
            None,
            None,
            None,
            hashlib.sha256(MALFORMED_PAYLOAD).hexdigest(),
            "INVALID_JOB_EVENT_JSON",
            "INVALID_JOB_EVENT_JSON",
            1,
        )
    ]
    assert "private" not in " ".join(str(value) for value in dead_letters[0])
    _assert_committed_after(
        kafka_brokers,
        group_id,
        kafka_topic,
        malformed_position,
    )


def _published_payload() -> bytes:
    return json.dumps(
        {
            "event_id": str(EVENT_ID),
            "action": "UPDATED",
            "job_id": str(JOB_ID),
            "company_id": str(COMPANY_ID),
            "title": "Backend Engineer",
            "description": "Build recruitment services",
            "skills": ["SQL", "NestJS", "Python"],
            "location": "Ha Noi",
            "status": "PUBLISHED",
            "occurred_at": "2026-08-24T00:00:00.000Z",
            "schema_version": 1,
            "aggregate_version": 42,
            "requirements": "NestJS, PostgreSQL and Kafka",
            "salary_min": "9999999999998.45",
            "salary_max": "9999999999999.45",
            "job_type": "FULL_TIME",
        },
        separators=(",", ":"),
    ).encode()


def _publish(
    producer: Producer,
    topic: str,
    *,
    key: bytes,
    value: bytes,
) -> tuple[int, int]:
    positions: list[tuple[int, int]] = []
    errors: list[str] = []

    def delivered(error: object | None, message: object) -> None:
        if error is not None:
            errors.append(str(error))
            return
        positions.append((message.partition(), message.offset()))  # type: ignore[attr-defined]

    producer.produce(
        topic,
        partition=0,
        key=key,
        value=value,
        on_delivery=delivered,
    )
    assert producer.flush(timeout=10) == 0
    assert errors == []
    assert len(positions) == 1
    return positions[0]


def _wait_for_terminal_rows(
    database_url: str,
    topic: str,
    worker_errors: list[Exception],
) -> None:
    deadline = time.monotonic() + 20
    last_counts: tuple[int, int, int] | None = None
    with psycopg.connect(database_url, autocommit=True) as connection:
        while time.monotonic() < deadline:
            if worker_errors:
                raise AssertionError("Kafka worker exited before terminal rows") from (
                    worker_errors[0]
                )
            last_counts = connection.execute(
                """
                SELECT
                    (SELECT count(*) FROM ai.job_embeddings WHERE job_id = %s),
                    (SELECT count(*) FROM ai.embedding_event_ledger
                        WHERE event_id = %s),
                    (SELECT count(*) FROM ai.embedding_dead_letters
                        WHERE topic = %s)
                """,
                (JOB_ID, EVENT_ID, topic),
            ).fetchone()
            if last_counts == (1, 1, 1):
                return
            time.sleep(0.1)
    raise AssertionError(f"Kafka ingestion timed out; counts={last_counts}")


def _assert_committed_after(
    brokers: str,
    group_id: str,
    topic: str,
    position: tuple[int, int],
) -> None:
    verifier = Consumer(
        {
            "bootstrap.servers": brokers,
            "group.id": group_id,
            "enable.auto.commit": False,
        }
    )
    try:
        committed = verifier.committed(
            [TopicPartition(topic, position[0])],
            timeout=10,
        )[0]
    finally:
        verifier.close()
    assert committed.offset == position[1] + 1
