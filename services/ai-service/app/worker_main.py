"""Lifecycle runner for a dedicated Kafka consumer process.

Concrete event processors and repositories are intentionally supplied by the
composition root.  Keeping them injected prevents importing FastAPI or loading an
ML model in the API process.
"""

from __future__ import annotations

import logging
import signal
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from threading import Event, current_thread, main_thread

from app.embedding import SentenceTransformerEmbeddingProvider
from app.ingestion_repository import PsycopgIngestionRepository
from app.job_ingestion import JobEventProcessor, PsycopgDeadLetterAdapter
from app.kafka_worker import (
    DeadLetterRepository,
    EventProcessor,
    KafkaConsumer,
    KafkaEventWorker,
    create_confluent_consumer,
)
from app.worker_config import JobWorkerSettings

logger = logging.getLogger(__name__)

ConsumerFactory = Callable[[], KafkaConsumer]


def run_worker_process(
    *,
    consumer_factory: ConsumerFactory,
    topics: Sequence[str],
    processor: EventProcessor,
    dead_letters: DeadLetterRepository,
    stop_event: Event | None = None,
    max_attempts: int = 3,
    retry_backoff_seconds: float = 1.0,
    poll_timeout_seconds: float = 1.0,
    reconnect_backoff_seconds: float = 5.0,
    install_signal_handlers: bool = True,
) -> None:
    """Run consumer sessions until SIGINT/SIGTERM requests shutdown.

    Broker, commit, and retryable processing failures close the current consumer
    session before a fresh client is created.  The durable processor contract makes
    replay after a failed synchronous offset commit safe.
    """

    normalized_topics = tuple(topic.strip() for topic in topics if topic.strip())
    if not normalized_topics:
        raise ValueError("at least one Kafka topic must be configured")
    if max_attempts <= 0:
        raise ValueError("max_attempts must be positive")
    if retry_backoff_seconds < 0:
        raise ValueError("retry_backoff_seconds must not be negative")
    if poll_timeout_seconds <= 0:
        raise ValueError("poll_timeout_seconds must be positive")
    if reconnect_backoff_seconds < 0:
        raise ValueError("reconnect_backoff_seconds must not be negative")

    shutdown = stop_event or Event()
    signal_context = (
        _shutdown_signal_handlers(shutdown)
        if install_signal_handlers
        else _unchanged_signal_handlers()
    )

    with signal_context:
        while not shutdown.is_set():
            try:
                consumer = consumer_factory()
                KafkaEventWorker(
                    consumer=consumer,
                    topics=normalized_topics,
                    processor=processor,
                    dead_letters=dead_letters,
                    max_attempts=max_attempts,
                    retry_backoff_seconds=retry_backoff_seconds,
                    poll_timeout_seconds=poll_timeout_seconds,
                ).run(shutdown)
            except Exception as error:
                logger.warning(
                    "Kafka worker session failed (%s); reconnecting",
                    type(error).__name__,
                )

            if not shutdown.is_set():
                shutdown.wait(reconnect_backoff_seconds)


@contextmanager
def _shutdown_signal_handlers(stop_event: Event) -> Iterator[None]:
    if current_thread() is not main_thread():
        raise RuntimeError("signal handlers can only be installed on the main thread")

    handled_signals = (signal.SIGINT, signal.SIGTERM)
    previous_handlers = {
        handled_signal: signal.getsignal(handled_signal)
        for handled_signal in handled_signals
    }

    def request_shutdown(_signum: int, _frame: object) -> None:
        stop_event.set()

    try:
        for handled_signal in handled_signals:
            signal.signal(handled_signal, request_shutdown)
        yield
    finally:
        for handled_signal, previous_handler in previous_handlers.items():
            signal.signal(handled_signal, previous_handler)


@contextmanager
def _unchanged_signal_handlers() -> Iterator[None]:
    yield


def main() -> None:
    """Compose and run the production Job embedding consumer."""

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    settings = JobWorkerSettings.from_environment()
    settings.validate()

    repository = PsycopgIngestionRepository(
        settings.database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )
    embedding_provider = SentenceTransformerEmbeddingProvider(
        model_name=settings.model_name,
        cache_folder=settings.model_cache,
        revision=settings.model_revision,
        local_files_only=settings.model_local_files_only,
    )
    embedding_provider.warm_up()
    processor = JobEventProcessor(
        topic=settings.job_topic,
        embedding_provider=embedding_provider,
        repository=repository,
    )
    dead_letters = PsycopgDeadLetterAdapter(repository)

    run_worker_process(
        consumer_factory=lambda: create_confluent_consumer(settings.consumer_config()),
        topics=(settings.job_topic,),
        processor=processor,
        dead_letters=dead_letters,
        max_attempts=settings.max_attempts,
        retry_backoff_seconds=settings.retry_backoff_seconds,
        poll_timeout_seconds=settings.poll_timeout_seconds,
        reconnect_backoff_seconds=settings.reconnect_backoff_seconds,
    )


if __name__ == "__main__":
    main()
