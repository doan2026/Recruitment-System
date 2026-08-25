"""Small, dependency-injected Kafka worker with at-least-once delivery semantics."""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Event
from typing import Protocol

logger = logging.getLogger(__name__)

_ERROR_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")


@dataclass(frozen=True, slots=True)
class ConsumedRecord:
    """Broker metadata plus the unparsed bytes needed by an event processor."""

    topic: str
    partition: int
    offset: int
    key: bytes | None
    value: bytes | None


@dataclass(frozen=True, slots=True)
class DeadLetterRecord:
    """Redacted poison-message metadata safe to persist and inspect."""

    topic: str
    partition: int
    offset: int
    key_sha256: str | None
    payload_sha256: str
    error_code: str
    attempts: int
    failed_at: datetime


class EventProcessor(Protocol):
    """Persist an idempotent terminal result before returning successfully."""

    def process(self, record: ConsumedRecord) -> None: ...


class DeadLetterRepository(Protocol):
    """Durably store redacted metadata for a permanently rejected event."""

    def record(self, dead_letter: DeadLetterRecord) -> None: ...


class KafkaMessage(Protocol):
    def error(self) -> object | None: ...

    def topic(self) -> str: ...

    def partition(self) -> int: ...

    def offset(self) -> int: ...

    def key(self) -> bytes | None: ...

    def value(self) -> bytes | None: ...


class KafkaConsumer(Protocol):
    def subscribe(self, topics: list[str]) -> None: ...

    def poll(self, timeout: float) -> KafkaMessage | None: ...

    def commit(
        self,
        message: KafkaMessage,
        asynchronous: bool,
    ) -> object: ...

    def close(self) -> None: ...


class RejectEvent(RuntimeError):
    """Signal that an invalid event may enter the sanitized dead-letter store."""

    def __init__(self, error_code: str) -> None:
        normalized_code = error_code.strip().upper()
        if not _ERROR_CODE_PATTERN.fullmatch(normalized_code):
            raise ValueError(
                "error_code may contain only uppercase letters, digits, and underscores"
            )
        self.error_code = normalized_code
        super().__init__(normalized_code)


class RetryableProcessingError(RuntimeError):
    """Signal an infrastructure failure that must not be committed or dead-lettered."""


class KafkaPollError(RuntimeError):
    """Raised when the Kafka client reports a broker or consumer error."""


class KafkaCommitError(RuntimeError):
    """Raised when a synchronous offset commit reports a partition failure."""


class ProcessingRetriesExhausted(RuntimeError):
    """Raised so the process runner reconnects without advancing the offset."""


class KafkaEventWorker:
    """Consume records sequentially and commit only durable terminal outcomes."""

    def __init__(
        self,
        *,
        consumer: KafkaConsumer,
        topics: Sequence[str],
        processor: EventProcessor,
        dead_letters: DeadLetterRepository,
        max_attempts: int = 3,
        retry_backoff_seconds: float = 1.0,
        poll_timeout_seconds: float = 1.0,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        normalized_topics = tuple(topic.strip() for topic in topics if topic.strip())
        if not normalized_topics:
            raise ValueError("at least one Kafka topic must be configured")
        if max_attempts <= 0:
            raise ValueError("max_attempts must be positive")
        if retry_backoff_seconds < 0:
            raise ValueError("retry_backoff_seconds must not be negative")
        if poll_timeout_seconds <= 0:
            raise ValueError("poll_timeout_seconds must be positive")

        self._consumer = consumer
        self._topics = normalized_topics
        self._processor = processor
        self._dead_letters = dead_letters
        self._max_attempts = max_attempts
        self._retry_backoff_seconds = retry_backoff_seconds
        self._poll_timeout_seconds = poll_timeout_seconds
        self._clock = clock or (lambda: datetime.now(UTC))

    def run(self, stop_event: Event) -> None:
        """Poll until stopped, closing the consumer on every exit path."""

        try:
            self._consumer.subscribe(list(self._topics))
            while not stop_event.is_set():
                message = self._consumer.poll(self._poll_timeout_seconds)
                if message is None:
                    continue
                if message.error() is not None:
                    raise KafkaPollError("Kafka consumer returned an error record")

                record = _to_consumed_record(message)
                if not self._process_with_retry(record, stop_event):
                    return

                # confluent-kafka commits the offset immediately after ``message``.
                # Synchronous commit is intentional: a failed commit is redelivered
                # and the processor/repository contract must be idempotent.
                _commit_synchronously(self._consumer, message)
        finally:
            try:
                self._consumer.close()
            except Exception as error:
                logger.warning(
                    "Kafka consumer close failed (%s)",
                    type(error).__name__,
                )

    def _process_with_retry(
        self,
        record: ConsumedRecord,
        stop_event: Event,
    ) -> bool:
        last_error: Exception | None = None

        for attempt in range(1, self._max_attempts + 1):
            try:
                self._processor.process(record)
                return True
            except Exception as error:
                last_error = error
                _log_processing_failure(record, error, attempt, self._max_attempts)

            if attempt < self._max_attempts:
                delay = self._retry_backoff_seconds * (2 ** (attempt - 1))
                if stop_event.wait(delay):
                    return False

        if isinstance(last_error, RejectEvent):
            self._dead_letters.record(
                _dead_letter_for(
                    record,
                    error_code=last_error.error_code,
                    attempts=self._max_attempts,
                    failed_at=self._clock(),
                )
            )
            return True

        raise ProcessingRetriesExhausted(
            "event processing retries were exhausted"
        ) from last_error


def _commit_synchronously(
    consumer: KafkaConsumer,
    message: KafkaMessage,
) -> None:
    result = consumer.commit(message=message, asynchronous=False)
    if result is None:
        return

    try:
        committed_partitions = tuple(result)  # type: ignore[arg-type]
    except TypeError:
        raise KafkaCommitError(
            "Kafka synchronous commit returned an invalid result"
        ) from None

    for partition in committed_partitions:
        if getattr(partition, "error", getattr(partition, "err", None)) is not None:
            raise KafkaCommitError("Kafka synchronous commit failed for a partition")


def create_confluent_consumer(config: Mapping[str, object]) -> KafkaConsumer:
    """Create a consumer while enforcing safe manual-offset settings."""

    try:
        from confluent_kafka import Consumer
    except ImportError as error:
        raise RuntimeError("confluent-kafka is required by the Kafka worker") from error

    consumer_config = dict(config)
    consumer_config["enable.auto.commit"] = False
    consumer_config["enable.auto.offset.store"] = False
    consumer_config.setdefault("enable.partition.eof", False)
    return Consumer(consumer_config)


def _to_consumed_record(message: KafkaMessage) -> ConsumedRecord:
    return ConsumedRecord(
        topic=message.topic(),
        partition=message.partition(),
        offset=message.offset(),
        key=_as_optional_bytes(message.key(), field_name="key"),
        value=_as_optional_bytes(message.value(), field_name="value"),
    )


def _as_optional_bytes(value: object, *, field_name: str) -> bytes | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray | memoryview):
        return bytes(value)
    raise KafkaPollError(f"Kafka message {field_name} was not bytes")


def _dead_letter_for(
    record: ConsumedRecord,
    *,
    error_code: str,
    attempts: int,
    failed_at: datetime,
) -> DeadLetterRecord:
    key_hash = (
        hashlib.sha256(record.key).hexdigest() if record.key is not None else None
    )
    return DeadLetterRecord(
        topic=record.topic,
        partition=record.partition,
        offset=record.offset,
        key_sha256=key_hash,
        payload_sha256=hashlib.sha256(record.value or b"").hexdigest(),
        error_code=error_code,
        attempts=attempts,
        failed_at=failed_at,
    )


def _log_processing_failure(
    record: ConsumedRecord,
    error: Exception,
    attempt: int,
    max_attempts: int,
) -> None:
    error_code = (
        error.error_code if isinstance(error, RejectEvent) else type(error).__name__
    )
    logger.warning(
        "Kafka event processing failed topic=%s partition=%d offset=%d "
        "attempt=%d/%d error=%s",
        record.topic,
        record.partition,
        record.offset,
        attempt,
        max_attempts,
        error_code,
    )
