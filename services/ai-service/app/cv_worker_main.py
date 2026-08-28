"""Composition root for the dedicated CV embedding consumer."""

from __future__ import annotations

import logging

from app.cv_ingestion import CvEventProcessor
from app.cv_parser import IsolatedPdfTextExtractor
from app.embedding import SentenceTransformerEmbeddingProvider
from app.ingestion_repository import PsycopgIngestionRepository
from app.job_ingestion import PsycopgDeadLetterAdapter
from app.kafka_worker import create_confluent_consumer
from app.media_client import HttpMediaCvClient
from app.worker_config import CvWorkerSettings
from app.worker_main import run_worker_process


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    settings = CvWorkerSettings.from_environment()
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
    media = HttpMediaCvClient(
        base_url=settings.media_service_url,
        internal_api_key=settings.media_internal_api_key,
        allowed_download_hosts=settings.media_download_allowed_hosts,
        request_timeout_seconds=settings.media_request_timeout_seconds,
        download_timeout_seconds=settings.media_download_timeout_seconds,
        maximum_file_bytes=settings.media_maximum_file_bytes,
        maximum_url_ttl_seconds=settings.media_maximum_url_ttl_seconds,
    )
    extractor = IsolatedPdfTextExtractor(
        timeout_seconds=settings.pdf_parser_timeout_seconds,
        maximum_pages=settings.pdf_maximum_pages,
        maximum_text_characters=settings.pdf_maximum_text_characters,
    )
    embedding_provider.warm_up()
    processor = CvEventProcessor(
        topic=settings.cv_topic,
        embedding_provider=embedding_provider,
        repository=repository,
        media_source=media,
        text_extractor=extractor,
    )
    try:
        run_worker_process(
            consumer_factory=lambda: create_confluent_consumer(
                settings.consumer_config()
            ),
            topics=(settings.cv_topic,),
            processor=processor,
            dead_letters=PsycopgDeadLetterAdapter(repository),
            max_attempts=settings.max_attempts,
            retry_backoff_seconds=settings.retry_backoff_seconds,
            poll_timeout_seconds=settings.poll_timeout_seconds,
            reconnect_backoff_seconds=settings.reconnect_backoff_seconds,
        )
    finally:
        media.close()


if __name__ == "__main__":
    main()
