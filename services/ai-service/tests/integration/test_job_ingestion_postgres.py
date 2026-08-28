from __future__ import annotations

import hashlib
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from alembic import command
from alembic.config import Config

from app.ingestion_repository import (
    EmbeddingRequired,
    EventIdentityConflict,
    IngestionContractError,
    IngestionEvent,
    IngestionOutcome,
    JobDeactivation,
    JobEmbeddingWrite,
    PsycopgIngestionRepository,
    TransportIdentityConflict,
)

pytestmark = pytest.mark.integration
SERVICE_ROOT = Path(__file__).resolve().parents[2]

JOB_ID = UUID("20000000-0000-0000-0000-000000000001")
MIGRATION_CV_ID = UUID("20000000-0000-0000-0000-000000000099")
MIGRATION_CANDIDATE_ID = UUID("30000000-0000-0000-0000-000000000099")
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
BASE_TIME = datetime(2026, 8, 26, 1, 0, tzinfo=UTC)


def test_migration_adds_private_event_state_without_raw_payload(
    database_url: str,
) -> None:
    with psycopg.connect(database_url) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'ai'
                """
            )
        }
        dead_letter_columns = {
            row[0]: row[1]
            for row in connection.execute(
                """
                SELECT column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'ai'
                  AND table_name = 'embedding_dead_letters'
                """
            )
        }
        provenance = {
            (row[0], row[1])
            for row in connection.execute(
                """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'ai'
                  AND table_name IN ('cv_embeddings', 'job_embeddings')
                  AND column_name LIKE 'source_%'
                """
            )
        }
        salary = connection.execute(
            """
            SELECT numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = 'ai'
              AND table_name = 'job_embeddings'
              AND column_name = 'salary_min'
            """
        ).fetchone()

    assert tables >= {
        "embedding_aggregate_cursors",
        "embedding_event_ledger",
        "embedding_dead_letters",
    }
    assert {"payload", "raw_payload", "job_description", "cv_text"}.isdisjoint(
        dead_letter_columns
    )
    assert dead_letter_columns["event_id"] == "YES"
    assert dead_letter_columns["aggregate_id"] == "YES"
    assert dead_letter_columns["key_hash"] == "YES"
    assert provenance == {
        ("cv_embeddings", "source_event_id"),
        ("cv_embeddings", "source_occurred_at"),
        ("cv_embeddings", "source_version"),
        ("job_embeddings", "source_event_id"),
        ("job_embeddings", "source_occurred_at"),
        ("job_embeddings", "source_version"),
    }
    assert salary == (15, 2)


def test_event_state_migration_downgrades_and_upgrades_cleanly(
    database_url: str,
) -> None:
    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    config = Config(str(SERVICE_ROOT / "alembic.ini"))

    try:
        command.downgrade(config, "20260825_01")
        with psycopg.connect(database_url) as connection:
            downgraded_version = connection.execute(
                "SELECT version_num FROM ai.alembic_version"
            ).fetchone()
            downgraded_salary = connection.execute(
                """
                SELECT numeric_precision, numeric_scale
                FROM information_schema.columns
                WHERE table_schema = 'ai'
                  AND table_name = 'job_embeddings'
                  AND column_name = 'salary_min'
                """
            ).fetchone()
            downgraded_tables = connection.execute(
                """
                SELECT
                    to_regclass('ai.embedding_event_ledger') IS NULL,
                    to_regclass('ai.embedding_aggregate_cursors') IS NULL,
                    to_regclass('ai.embedding_dead_letters') IS NULL,
                    to_regclass('ai.cv_aggregate_owners') IS NULL
                """
            ).fetchone()
            connection.execute(
                """
                INSERT INTO ai.cv_embeddings (
                    cv_id, user_id, vector, text_hash, model_name
                ) VALUES (
                    %s, %s,
                    ('[' || repeat('0,', 383) || '0]')::vector,
                    repeat('a', 64),
                    'migration-backfill-test'
                )
                """,
                (MIGRATION_CV_ID, MIGRATION_CANDIDATE_ID),
            )
        assert downgraded_version == ("20260825_01",)
        assert downgraded_salary == (14, 2)
        assert downgraded_tables == (True, True, True, True)
    finally:
        try:
            command.upgrade(config, "head")
        finally:
            if previous_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_url

    with psycopg.connect(database_url) as connection:
        upgraded_version = connection.execute(
            "SELECT version_num FROM ai.alembic_version"
        ).fetchone()
        upgraded_salary = connection.execute(
            """
            SELECT numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = 'ai'
              AND table_name = 'job_embeddings'
              AND column_name = 'salary_min'
            """
        ).fetchone()
        upgraded_tables = connection.execute(
            """
            SELECT
                to_regclass('ai.embedding_event_ledger') IS NOT NULL,
                to_regclass('ai.embedding_aggregate_cursors') IS NOT NULL,
                to_regclass('ai.embedding_dead_letters') IS NOT NULL,
                to_regclass('ai.cv_aggregate_owners') IS NOT NULL
            """
        ).fetchone()
        backfilled_owner = connection.execute(
            """
            SELECT user_id
            FROM ai.cv_aggregate_owners
            WHERE cv_id = %s
            """,
            (MIGRATION_CV_ID,),
        ).fetchone()
    assert upgraded_version == ("20260828_04",)
    assert upgraded_salary == (15, 2)
    assert upgraded_tables == (True, True, True, True)
    assert backfilled_owner == (MIGRATION_CANDIDATE_ID,)


def test_upsert_commits_embedding_cursor_and_ledger_atomically(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    event = _event(1, version=1, state="published-v1")
    write = _write(
        event,
        location="Ha Noi",
        salary_min=Decimal("9999999999998.45"),
        salary_max=Decimal("9999999999999.45"),
        is_active=True,
    )

    assert repository.upsert_job(write) is IngestionOutcome.APPLIED
    assert repository.lookup_event(event.event_id, event.payload_hash) is (
        IngestionOutcome.APPLIED
    )
    assert repository.upsert_job(write) is IngestionOutcome.SKIPPED_DUPLICATE

    with psycopg.connect(database_url) as connection:
        embedding = connection.execute(
            """
            SELECT text_hash, model_name, location, salary_min, salary_max,
                   is_active, source_event_id, source_version, source_occurred_at
            FROM ai.job_embeddings
            WHERE job_id = %s
            """,
            (JOB_ID,),
        ).fetchone()
        cursor = connection.execute(
            """
            SELECT last_event_id, last_aggregate_version, last_state_hash,
                   tombstoned
            FROM ai.embedding_aggregate_cursors
            WHERE aggregate_type = 'JOB' AND aggregate_id = %s
            """,
            (JOB_ID,),
        ).fetchone()
        ledger_count = connection.execute(
            "SELECT count(*) FROM ai.embedding_event_ledger"
        ).fetchone()

    assert embedding == (
        _hash("text"),
        MODEL_NAME,
        "Ha Noi",
        Decimal("9999999999998.45"),
        Decimal("9999999999999.45"),
        True,
        event.event_id,
        1,
        event.occurred_at,
    )
    assert cursor == (event.event_id, 1, event.state_hash, False)
    assert ledger_count == (1,)


def test_same_event_id_with_changed_payload_is_rejected_without_mutation(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    original = _event(2, version=1, state="original")
    repository.upsert_job(_write(original, location="Original"))
    changed = replace(
        original,
        payload_hash=_hash("mutated-payload"),
        state_hash=_hash("mutated-state"),
    )

    with pytest.raises(EventIdentityConflict):
        repository.upsert_job(_write(changed, location="Mutated"))

    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            "SELECT location, source_event_id FROM ai.job_embeddings"
        ).fetchone()
        count = connection.execute(
            "SELECT count(*) FROM ai.embedding_event_ledger"
        ).fetchone()
    assert row == ("Original", original.event_id)
    assert count == (1,)


def test_dead_letter_rejects_reused_event_id_with_changed_payload(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    original = _event(18, version=1, state="original", offset=80)
    repository.upsert_job(_write(original, location="Original"))
    changed = replace(
        original,
        offset=81,
        payload_hash=_hash("changed-payload"),
        state_hash=_hash("changed-state"),
    )

    with pytest.raises(EventIdentityConflict):
        repository.dead_letter_job(
            changed,
            JOB_ID,
            error_code="EMBEDDING_FAILED",
            safe_message="Embedding failed",
            attempt_count=3,
        )

    with psycopg.connect(database_url) as connection:
        embedding = connection.execute(
            "SELECT location, source_event_id FROM ai.job_embeddings"
        ).fetchone()
        counts = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM ai.embedding_event_ledger),
                (SELECT count(*) FROM ai.embedding_dead_letters),
                (SELECT count(*) FROM ai.embedding_aggregate_cursors)
            """
        ).fetchone()
    assert embedding == ("Original", original.event_id)
    assert counts == (1, 0, 1)


def test_dead_letter_rejects_transport_position_already_used_by_ledger(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    original = _event(19, version=1, state="original", offset=90)
    repository.upsert_job(_write(original, location="Original"))
    conflicting = _event(20, version=2, state="conflicting", offset=90)

    with pytest.raises(TransportIdentityConflict):
        repository.dead_letter_job(
            conflicting,
            JOB_ID,
            error_code="EMBEDDING_FAILED",
            safe_message="Embedding failed",
            attempt_count=3,
        )

    with psycopg.connect(database_url) as connection:
        embedding = connection.execute(
            "SELECT location, source_event_id FROM ai.job_embeddings"
        ).fetchone()
        cursor = connection.execute(
            """
            SELECT last_event_id, last_aggregate_version
            FROM ai.embedding_aggregate_cursors
            """
        ).fetchone()
        counts = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM ai.embedding_event_ledger),
                (SELECT count(*) FROM ai.embedding_dead_letters)
            """
        ).fetchone()
    assert embedding == ("Original", original.event_id)
    assert cursor == (original.event_id, 1)
    assert counts == (1, 0)


def test_aggregate_version_prevents_late_event_from_overwriting_newer_state(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    newer = _event(3, version=4, state="newer")
    older = _event(
        4,
        version=3,
        state="older",
        occurred_at=BASE_TIME + timedelta(hours=1),
    )

    assert repository.upsert_job(_write(newer, location="New")) is (
        IngestionOutcome.APPLIED
    )
    assert repository.upsert_job(_write(older, location="Old")) is (
        IngestionOutcome.SKIPPED_STALE
    )

    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            "SELECT location, source_version FROM ai.job_embeddings"
        ).fetchone()
        stale = connection.execute(
            """
            SELECT outcome FROM ai.embedding_event_ledger WHERE event_id = %s
            """,
            (older.event_id,),
        ).fetchone()
    assert row == ("New", 4)
    assert stale == ("SKIPPED_STALE",)


def test_legacy_events_use_timestamp_then_partition_offset_order(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    first = _event(5, version=None, state="first", offset=10)
    same_time_later = _event(6, version=None, state="second", offset=11)
    late_delivery_of_old_state = _event(
        7,
        version=None,
        state="old",
        offset=12,
        occurred_at=BASE_TIME - timedelta(seconds=1),
    )

    assert repository.upsert_job(_write(first, location="First")) is (
        IngestionOutcome.APPLIED
    )
    assert repository.upsert_job(_write(same_time_later, location="Second")) is (
        IngestionOutcome.APPLIED
    )
    assert (
        repository.upsert_job(_write(late_delivery_of_old_state, location="Old"))
        is IngestionOutcome.SKIPPED_STALE
    )

    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            "SELECT location, source_event_id FROM ai.job_embeddings"
        ).fetchone()
    assert row == ("Second", same_time_later.event_id)


def test_deactivation_and_tombstone_block_stale_or_resurrecting_updates(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    created = _event(8, version=1, state="published")
    closed = _event(9, version=3, state="closed", action="CLOSED")
    stale = _event(10, version=2, state="published-again")
    deleted = _event(11, version=4, state="deleted", action="DELETED")
    later = _event(12, version=5, state="resurrect")

    repository.upsert_job(_write(created, is_active=True))
    assert repository.deactivate_job(JobDeactivation(closed, JOB_ID)) is (
        IngestionOutcome.APPLIED
    )
    assert repository.upsert_job(_write(stale, is_active=True)) is (
        IngestionOutcome.SKIPPED_STALE
    )
    assert (
        repository.deactivate_job(JobDeactivation(deleted, JOB_ID, tombstone=True))
        is IngestionOutcome.APPLIED
    )
    assert repository.upsert_job(_write(later, is_active=True)) is (
        IngestionOutcome.SKIPPED_STALE
    )

    with psycopg.connect(database_url) as connection:
        embedding_count = connection.execute(
            "SELECT count(*) FROM ai.job_embeddings"
        ).fetchone()
        cursor = connection.execute(
            """
            SELECT last_event_id, tombstoned
            FROM ai.embedding_aggregate_cursors
            """
        ).fetchone()
    assert embedding_count == (0,)
    assert cursor == (deleted.event_id, True)


def test_same_state_at_newer_version_advances_cursor_without_rewriting_vector(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    first = _event(13, version=1, state="same")
    reissued = _event(14, version=2, state="same")
    repository.upsert_job(_write(first, location="Stable"))

    outcome = repository.upsert_job(
        _write(reissued, vector=_vector(-1.0), location="Ignored")
    )

    assert outcome is IngestionOutcome.SKIPPED_UNCHANGED
    with psycopg.connect(database_url) as connection:
        embedding = connection.execute(
            "SELECT location, source_event_id FROM ai.job_embeddings"
        ).fetchone()
        cursor = connection.execute(
            """
            SELECT last_event_id, last_aggregate_version
            FROM ai.embedding_aggregate_cursors
            """
        ).fetchone()
    assert embedding == ("Stable", first.event_id)
    assert cursor == (reissued.event_id, 2)


def test_valid_and_malformed_dead_letters_store_only_sanitized_metadata(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    event = _event(15, version=1, state="invalid")
    assert (
        repository.dead_letter_job(
            event,
            JOB_ID,
            error_code="EMBEDDING_FAILED",
            safe_message="Model rejected source text",
            attempt_count=3,
        )
        is IngestionOutcome.DEAD_LETTER
    )
    key_hash = _hash("raw-key-never-stored")
    payload_hash = _hash("raw-json-never-stored")
    assert (
        repository.record_transport_dead_letter(
            topic="job-events",
            partition=2,
            offset=99,
            key_hash=key_hash,
            payload_hash=payload_hash,
            error_code="MALFORMED_EVENT",
            attempt_count=3,
        )
        is IngestionOutcome.DEAD_LETTER
    )
    assert (
        repository.record_transport_dead_letter(
            topic="job-events",
            partition=2,
            offset=99,
            key_hash=key_hash,
            payload_hash=payload_hash,
            error_code="MALFORMED_EVENT",
            attempt_count=3,
        )
        is IngestionOutcome.DEAD_LETTER
    )

    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            """
            SELECT event_id, key_hash, aggregate_id, payload_hash, error_code,
                   error_message, attempt_count
            FROM ai.embedding_dead_letters
            ORDER BY id
            """
        ).fetchall()
    assert rows == [
        (
            event.event_id,
            None,
            JOB_ID,
            event.payload_hash,
            "EMBEDDING_FAILED",
            "Model rejected source text",
            3,
        ),
        (
            None,
            key_hash,
            None,
            payload_hash,
            "MALFORMED_EVENT",
            "MALFORMED_EVENT",
            3,
        ),
    ]

    with pytest.raises(TransportIdentityConflict):
        repository.record_transport_dead_letter(
            topic="job-events",
            partition=2,
            offset=99,
            key_hash=key_hash,
            payload_hash=_hash("changed"),
            error_code="MALFORMED_EVENT",
            attempt_count=3,
        )


def test_invalid_embedding_does_not_write_partial_terminal_state(
    database_url: str,
) -> None:
    repository = _repository(database_url)
    event = _event(16, version=1, state="invalid-vector")

    with pytest.raises(EmbeddingRequired):
        repository.upsert_job(_write(event, vector=(1.0, 0.0)))

    with psycopg.connect(database_url) as connection:
        counts = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM ai.job_embeddings),
                (SELECT count(*) FROM ai.embedding_aggregate_cursors),
                (SELECT count(*) FROM ai.embedding_event_ledger)
            """
        ).fetchone()
    assert counts == (0, 0, 0)


@pytest.mark.parametrize(
    ("version", "salary_min"),
    [
        (9_223_372_036_854_775_808, None),
        (1, Decimal("10000000000000.00")),
        (1, Decimal("1.001")),
    ],
)
def test_numeric_bounds_are_rejected_without_terminal_state(
    database_url: str,
    version: int,
    salary_min: Decimal | None,
) -> None:
    repository = _repository(database_url)
    event = _event(17, version=version, state="invalid-numeric")

    with pytest.raises(IngestionContractError):
        repository.upsert_job(_write(event, salary_min=salary_min))

    with psycopg.connect(database_url) as connection:
        counts = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM ai.job_embeddings),
                (SELECT count(*) FROM ai.embedding_aggregate_cursors),
                (SELECT count(*) FROM ai.embedding_event_ledger)
            """
        ).fetchone()
    assert counts == (0, 0, 0)


def _repository(database_url: str) -> PsycopgIngestionRepository:
    return PsycopgIngestionRepository(database_url)


def _event(
    sequence: int,
    *,
    version: int | None,
    state: str,
    action: str = "UPDATED",
    occurred_at: datetime = BASE_TIME,
    partition: int = 0,
    offset: int | None = None,
) -> IngestionEvent:
    return IngestionEvent(
        event_id=UUID(int=sequence),
        topic="job-events",
        partition=partition,
        offset=sequence if offset is None else offset,
        aggregate_type="JOB",
        aggregate_id=JOB_ID,
        action=action,
        occurred_at=occurred_at,
        payload_hash=_hash(f"payload-{sequence}"),
        state_hash=_hash(state),
        aggregate_version=version,
    )


def _write(
    event: IngestionEvent,
    *,
    vector: tuple[float, ...] | None = None,
    location: str | None = None,
    salary_min: Decimal | None = None,
    salary_max: Decimal | None = None,
    is_active: bool = False,
) -> JobEmbeddingWrite:
    return JobEmbeddingWrite(
        event=event,
        job_id=JOB_ID,
        vector=vector or _vector(1.0),
        text_hash=_hash("text"),
        model_name=MODEL_NAME,
        location=location,
        salary_min=salary_min,
        salary_max=salary_max,
        job_type="FULL_TIME",
        is_active=is_active,
    )


def _vector(first: float) -> tuple[float, ...]:
    return (first, *([0.0] * 383))


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
