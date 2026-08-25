"""Unit tests for Kafka delivery, retry, DLQ, and process lifecycle semantics."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Event
from types import ModuleType

import pytest

import app.worker_main as worker_main
from app.kafka_worker import (
    ConsumedRecord,
    DeadLetterRecord,
    KafkaCommitError,
    KafkaEventWorker,
    KafkaPollError,
    ProcessingRetriesExhausted,
    RejectEvent,
    RetryableProcessingError,
    create_confluent_consumer,
)
from app.worker_main import run_worker_process


@dataclass
class FakeMessage:
    raw_key: bytes | None = b"job-id"
    raw_value: bytes | None = b'{"private":"job description"}'
    kafka_error: object | None = None

    def error(self) -> object | None:
        return self.kafka_error

    def topic(self) -> str:
        return "job-events"

    def partition(self) -> int:
        return 1

    def offset(self) -> int:
        return 42

    def key(self) -> bytes | None:
        return self.raw_key

    def value(self) -> bytes | None:
        return self.raw_value


@dataclass
class FakeCommitPartition:
    error: object | None = None


@dataclass
class FakeConsumer:
    messages: list[FakeMessage | None]
    calls: list[str] = field(default_factory=list)
    committed: list[tuple[FakeMessage, bool]] = field(default_factory=list)
    on_empty_poll: Callable[[], None] | None = None
    commit_result: object | None = None

    def subscribe(self, topics: list[str]) -> None:
        self.calls.append(f"subscribe:{','.join(topics)}")

    def poll(self, timeout: float) -> FakeMessage | None:
        self.calls.append(f"poll:{timeout}")
        if self.messages:
            return self.messages.pop(0)
        if self.on_empty_poll is not None:
            self.on_empty_poll()
        return None

    def commit(self, message: FakeMessage, asynchronous: bool) -> object:
        self.calls.append("commit")
        self.committed.append((message, asynchronous))
        return self.commit_result

    def close(self) -> None:
        self.calls.append("close")


@dataclass
class StubProcessor:
    outcomes: list[Exception | None]
    stop_event: Event | None = None
    calls: list[ConsumedRecord] = field(default_factory=list)

    def process(self, record: ConsumedRecord) -> None:
        self.calls.append(record)
        outcome = self.outcomes.pop(0) if self.outcomes else None
        if outcome is not None:
            raise outcome
        if self.stop_event is not None:
            self.stop_event.set()


@dataclass
class StubDeadLetters:
    stop_event: Event | None = None
    error: Exception | None = None
    records: list[DeadLetterRecord] = field(default_factory=list)

    def record(self, dead_letter: DeadLetterRecord) -> None:
        self.records.append(dead_letter)
        if self.error is not None:
            raise self.error
        if self.stop_event is not None:
            self.stop_event.set()


def make_worker(
    *,
    consumer: FakeConsumer,
    processor: StubProcessor,
    dead_letters: StubDeadLetters,
    clock: Callable[[], datetime] | None = None,
) -> KafkaEventWorker:
    return KafkaEventWorker(
        consumer=consumer,
        topics=["job-events"],
        processor=processor,
        dead_letters=dead_letters,
        retry_backoff_seconds=0,
        poll_timeout_seconds=0.01,
        clock=clock,
    )


def test_success_is_synchronously_committed_after_terminal_processing() -> None:
    stop_event = Event()
    message = FakeMessage()
    consumer = FakeConsumer([message])
    processor = StubProcessor([None], stop_event=stop_event)

    make_worker(
        consumer=consumer,
        processor=processor,
        dead_letters=StubDeadLetters(),
    ).run(stop_event)

    assert processor.calls == [
        ConsumedRecord(
            topic="job-events",
            partition=1,
            offset=42,
            key=b"job-id",
            value=b'{"private":"job description"}',
        )
    ]
    assert consumer.committed == [(message, False)]
    assert consumer.calls.index("commit") < consumer.calls.index("close")


def test_partition_commit_error_closes_without_advancing_offset() -> None:
    stop_event = Event()
    message = FakeMessage()
    consumer = FakeConsumer(
        [message],
        commit_result=[FakeCommitPartition(error=object())],
    )
    processor = StubProcessor([None], stop_event=stop_event)

    with pytest.raises(KafkaCommitError):
        make_worker(
            consumer=consumer,
            processor=processor,
            dead_letters=StubDeadLetters(),
        ).run(stop_event)

    assert len(processor.calls) == 1
    assert consumer.committed == [(message, False)]
    assert consumer.calls[-1] == "close"


def test_rejected_event_is_retried_then_redacted_dlq_is_committed(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop_event = Event()
    private_payload = b"candidate secret salary"
    private_error = "candidate secret exception"
    message = FakeMessage(raw_key=b"private-id", raw_value=private_payload)
    consumer = FakeConsumer([message])
    processor = StubProcessor(
        [
            RejectEvent("INVALID_EVENT"),
            RejectEvent("INVALID_EVENT"),
            RejectEvent("INVALID_EVENT"),
        ]
    )
    dead_letters = StubDeadLetters(stop_event=stop_event)
    failed_at = datetime(2026, 8, 26, 8, 30, tzinfo=UTC)

    with caplog.at_level("WARNING"):
        make_worker(
            consumer=consumer,
            processor=processor,
            dead_letters=dead_letters,
            clock=lambda: failed_at,
        ).run(stop_event)

    assert len(processor.calls) == 3
    assert dead_letters.records == [
        DeadLetterRecord(
            topic="job-events",
            partition=1,
            offset=42,
            key_sha256=hashlib.sha256(b"private-id").hexdigest(),
            payload_sha256=hashlib.sha256(private_payload).hexdigest(),
            error_code="INVALID_EVENT",
            attempts=3,
            failed_at=failed_at,
        )
    ]
    assert consumer.committed == [(message, False)]
    assert private_payload.decode() not in repr(dead_letters.records[0])
    assert private_error not in caplog.text


def test_retryable_failure_is_not_dead_lettered_or_committed() -> None:
    stop_event = Event()
    consumer = FakeConsumer([FakeMessage()])
    processor = StubProcessor(
        [
            RetryableProcessingError("database unavailable"),
            RetryableProcessingError("database unavailable"),
            RetryableProcessingError("database unavailable"),
        ]
    )
    dead_letters = StubDeadLetters()

    with pytest.raises(ProcessingRetriesExhausted):
        make_worker(
            consumer=consumer,
            processor=processor,
            dead_letters=dead_letters,
        ).run(stop_event)

    assert len(processor.calls) == 3
    assert dead_letters.records == []
    assert consumer.committed == []
    assert consumer.calls[-1] == "close"


def test_failed_dead_letter_write_does_not_commit_offset() -> None:
    stop_event = Event()
    consumer = FakeConsumer([FakeMessage()])
    processor = StubProcessor([RejectEvent("BAD_JSON")] * 3)
    dead_letters = StubDeadLetters(error=RuntimeError("database unavailable"))

    with pytest.raises(RuntimeError, match="database unavailable"):
        make_worker(
            consumer=consumer,
            processor=processor,
            dead_letters=dead_letters,
        ).run(stop_event)

    assert len(dead_letters.records) == 1
    assert consumer.committed == []
    assert consumer.calls[-1] == "close"


def test_kafka_error_record_reconnects_without_processing_or_commit() -> None:
    consumer = FakeConsumer([FakeMessage(kafka_error=object())])
    processor = StubProcessor([])

    with pytest.raises(KafkaPollError):
        make_worker(
            consumer=consumer,
            processor=processor,
            dead_letters=StubDeadLetters(),
        ).run(Event())

    assert processor.calls == []
    assert consumer.committed == []
    assert consumer.calls[-1] == "close"


def test_shutdown_during_retry_leaves_offset_uncommitted() -> None:
    stop_event = Event()
    consumer = FakeConsumer([FakeMessage()])

    class StopOnFailureProcessor:
        def process(self, _record: ConsumedRecord) -> None:
            stop_event.set()
            raise RetryableProcessingError("temporary failure")

    make_worker(
        consumer=consumer,
        processor=StopOnFailureProcessor(),  # type: ignore[arg-type]
        dead_letters=StubDeadLetters(),
    ).run(stop_event)

    assert consumer.committed == []
    assert consumer.calls[-1] == "close"


def test_confluent_factory_forces_manual_commit_and_offset_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[dict[str, object]] = []
    fake_module = ModuleType("confluent_kafka")

    class FakeConfluentConsumer:
        def __init__(self, config: dict[str, object]) -> None:
            captured.append(config)

    fake_module.Consumer = FakeConfluentConsumer  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "confluent_kafka", fake_module)

    created = create_confluent_consumer(
        {
            "bootstrap.servers": "kafka:9092",
            "group.id": "ai-service-group",
            "enable.auto.commit": True,
            "enable.auto.offset.store": True,
        }
    )

    assert isinstance(created, FakeConfluentConsumer)
    assert captured == [
        {
            "bootstrap.servers": "kafka:9092",
            "group.id": "ai-service-group",
            "enable.auto.commit": False,
            "enable.auto.offset.store": False,
            "enable.partition.eof": False,
        }
    ]


def test_process_runner_closes_failed_session_and_reconnects() -> None:
    stop_event = Event()
    first = FakeConsumer([FakeMessage(kafka_error=object())])
    second = FakeConsumer([], on_empty_poll=stop_event.set)
    consumers = [first, second]

    run_worker_process(
        consumer_factory=lambda: consumers.pop(0),
        topics=["job-events"],
        processor=StubProcessor([]),
        dead_letters=StubDeadLetters(),
        stop_event=stop_event,
        retry_backoff_seconds=0,
        poll_timeout_seconds=0.01,
        reconnect_backoff_seconds=0,
        install_signal_handlers=False,
    )

    assert first.calls[-1] == "close"
    assert second.calls[-1] == "close"
    assert consumers == []


def test_sigterm_requests_shutdown_and_restores_previous_handlers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stop_event = Event()
    installed: dict[int, object] = {}
    previous = {
        worker_main.signal.SIGINT: object(),
        worker_main.signal.SIGTERM: object(),
    }

    def fake_signal(signum: int, handler: object) -> object:
        installed[signum] = handler
        return previous[signum]

    monkeypatch.setattr(
        worker_main.signal,
        "getsignal",
        lambda signum: previous[signum],
    )
    monkeypatch.setattr(worker_main.signal, "signal", fake_signal)

    def send_sigterm() -> None:
        handler = installed[worker_main.signal.SIGTERM]
        assert callable(handler)
        handler(worker_main.signal.SIGTERM, None)

    consumer = FakeConsumer([], on_empty_poll=send_sigterm)

    run_worker_process(
        consumer_factory=lambda: consumer,
        topics=["job-events"],
        processor=StubProcessor([]),
        dead_letters=StubDeadLetters(),
        stop_event=stop_event,
        poll_timeout_seconds=0.01,
    )

    assert stop_event.is_set()


def test_main_warms_model_before_starting_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = worker_main.JobWorkerSettings(
        database_url="postgresql://db",
        kafka_brokers=("kafka:9092",),
    )
    lifecycle: list[str] = []

    class StubProvider:
        def __init__(self, **_options: object) -> None:
            lifecycle.append("provider-created")

        def warm_up(self) -> None:
            lifecycle.append("model-warmed")

    monkeypatch.setattr(
        worker_main.JobWorkerSettings,
        "from_environment",
        classmethod(lambda _cls: settings),
    )
    monkeypatch.setattr(
        worker_main,
        "PsycopgIngestionRepository",
        lambda *_args, **_options: object(),
    )
    monkeypatch.setattr(
        worker_main, "SentenceTransformerEmbeddingProvider", StubProvider
    )
    monkeypatch.setattr(
        worker_main,
        "JobEventProcessor",
        lambda **_options: object(),
    )
    monkeypatch.setattr(
        worker_main,
        "PsycopgDeadLetterAdapter",
        lambda _repository: object(),
    )
    monkeypatch.setattr(
        worker_main,
        "run_worker_process",
        lambda **_options: lifecycle.append("worker-started"),
    )

    worker_main.main()

    assert lifecycle == ["provider-created", "model-warmed", "worker-started"]
