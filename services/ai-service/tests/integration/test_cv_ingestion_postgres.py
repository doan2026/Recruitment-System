from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
import pytest

from app.ingestion_repository import (
    CvDeactivation,
    CvEmbeddingWrite,
    IngestionContractError,
    IngestionEvent,
    IngestionOutcome,
    PsycopgIngestionRepository,
)

pytestmark = pytest.mark.integration

CV_ID = UUID("20000000-0000-0000-0000-000000000001")
CANDIDATE_ID = UUID("30000000-0000-0000-0000-000000000001")
OTHER_CANDIDATE_ID = UUID("30000000-0000-0000-0000-000000000099")
BASE_TIME = datetime(2026, 8, 28, 1, 0, tzinfo=UTC)
MODEL = "integration/cv-model@revision"
VECTOR = (1.0,) + (0.0,) * 383


def test_cv_migration_adds_active_filter_without_raw_content(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        column = connection.execute(
            """
            SELECT is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'ai'
              AND table_name = 'cv_embeddings'
              AND column_name = 'is_active'
            """
        ).fetchone()
        indexes = {
            row[0]
            for row in connection.execute(
                """
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'ai' AND tablename = 'cv_embeddings'
                """
            )
        }
        columns = {
            row[0]
            for row in connection.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'ai' AND table_name = 'cv_embeddings'
                """
            )
        }
        owner_columns = {
            row[0]
            for row in connection.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'ai'
                  AND table_name = 'cv_aggregate_owners'
                """
            )
        }
    assert column == ("NO", "true")
    assert "cv_embeddings_active_user_idx" in indexes
    assert {"raw_payload", "cv_text", "file_url", "content_json"}.isdisjoint(columns)
    assert owner_columns == {"cv_id", "user_id", "created_at"}
    assert {"raw_payload", "cv_text", "file_url", "content_json"}.isdisjoint(
        owner_columns
    )


def test_soft_deactivate_retains_vector_then_delete_tombstones_permanently(
    database_url: str,
) -> None:
    repository = PsycopgIngestionRepository(database_url)
    upserted = event(1, action="UPSERTED", version=1, state="active")
    assert repository.upsert_cv(write(upserted)) is IngestionOutcome.APPLIED

    deactivated = event(2, action="DEACTIVATED", version=2, state="inactive")
    assert (
        repository.deactivate_cv(
            CvDeactivation(deactivated, CV_ID, CANDIDATE_ID, tombstone=False)
        )
        is IngestionOutcome.APPLIED
    )
    with psycopg.connect(database_url) as connection:
        retained = connection.execute(
            """
            SELECT vector_dims(vector), user_id, is_active, source_version
            FROM ai.cv_embeddings WHERE cv_id = %s
            """,
            (CV_ID,),
        ).fetchone()
    assert retained == (384, CANDIDATE_ID, False, 2)

    reactivation = event(5, action="UPSERTED", version=3, state="reactivation")
    assert repository.upsert_cv(write(reactivation)) is IngestionOutcome.SKIPPED_STALE
    with psycopg.connect(database_url) as connection:
        still_inactive = connection.execute(
            "SELECT is_active, source_version FROM ai.cv_embeddings WHERE cv_id = %s",
            (CV_ID,),
        ).fetchone()
    assert still_inactive == (False, 2)

    deleted = event(3, action="DELETED", version=4, state="tombstone")
    assert (
        repository.deactivate_cv(
            CvDeactivation(deleted, CV_ID, CANDIDATE_ID, tombstone=True)
        )
        is IngestionOutcome.APPLIED
    )
    stale_resurrection = replace(
        event(4, action="UPSERTED", version=4, state="resurrection"),
        event_id=UUID("10000000-0000-4000-8000-000000000004"),
    )
    assert (
        repository.upsert_cv(write(stale_resurrection))
        is IngestionOutcome.SKIPPED_STALE
    )

    with psycopg.connect(database_url) as connection:
        state = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM ai.cv_embeddings WHERE cv_id = %s),
                (SELECT tombstoned FROM ai.embedding_aggregate_cursors
                    WHERE aggregate_type = 'CV' AND aggregate_id = %s),
                (SELECT user_id FROM ai.cv_aggregate_owners WHERE cv_id = %s),
                (SELECT array_agg(outcome ORDER BY kafka_offset)
                    FROM ai.embedding_event_ledger
                    WHERE aggregate_type = 'CV' AND aggregate_id = %s)
            """,
            (CV_ID, CV_ID, CV_ID, CV_ID),
        ).fetchone()
    assert state == (
        0,
        True,
        CANDIDATE_ID,
        ["APPLIED", "APPLIED", "APPLIED", "SKIPPED_STALE", "SKIPPED_STALE"],
    )


def test_parsed_poison_dead_letter_is_atomic_idempotent_and_does_not_advance_cursor(
    database_url: str,
) -> None:
    repository = PsycopgIngestionRepository(database_url)
    rejected = event(10, action="UPSERTED", version=1, state="rejected")

    assert (
        repository.dead_letter_cv(
            rejected,
            CV_ID,
            CANDIDATE_ID,
            error_code="CV_PDF_TEXT_EMPTY",
            safe_message="CV_PDF_TEXT_EMPTY",
            attempt_count=1,
        )
        is IngestionOutcome.DEAD_LETTER
    )
    assert (
        repository.dead_letter_cv(
            rejected,
            CV_ID,
            CANDIDATE_ID,
            error_code="CV_PDF_TEXT_EMPTY",
            safe_message="CV_PDF_TEXT_EMPTY",
            attempt_count=1,
        )
        is IngestionOutcome.DEAD_LETTER
    )

    with psycopg.connect(database_url) as connection:
        persisted = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM ai.embedding_event_ledger
                    WHERE event_id = %s AND outcome = 'DEAD_LETTER'),
                (SELECT count(*) FROM ai.embedding_dead_letters
                    WHERE event_id = %s AND error_code = 'CV_PDF_TEXT_EMPTY'),
                (SELECT count(*) FROM ai.embedding_aggregate_cursors
                    WHERE aggregate_type = 'CV' AND aggregate_id = %s),
                (SELECT count(*) FROM ai.cv_embeddings WHERE cv_id = %s),
                (SELECT user_id FROM ai.cv_aggregate_owners WHERE cv_id = %s)
            """,
            (rejected.event_id, rejected.event_id, CV_ID, CV_ID, CV_ID),
        ).fetchone()
        stored_text = connection.execute(
            """
            SELECT error_message FROM ai.embedding_dead_letters WHERE event_id = %s
            """,
            (rejected.event_id,),
        ).fetchone()
    assert persisted == (1, 1, 0, 0, CANDIDATE_ID)
    assert stored_text == ("CV_PDF_TEXT_EMPTY",)

    conflicting = event(11, action="UPSERTED", version=2, state="other-owner")
    with pytest.raises(
        IngestionContractError,
        match="already owned by another candidate",
    ):
        repository.dead_letter_cv(
            conflicting,
            CV_ID,
            OTHER_CANDIDATE_ID,
            error_code="CV_PDF_TEXT_EMPTY",
            safe_message="CV_PDF_TEXT_EMPTY",
            attempt_count=1,
        )
    with psycopg.connect(database_url) as connection:
        conflicting_rows = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM ai.embedding_event_ledger
                    WHERE event_id = %s),
                (SELECT count(*) FROM ai.embedding_dead_letters
                    WHERE event_id = %s),
                (SELECT user_id FROM ai.cv_aggregate_owners WHERE cv_id = %s)
            """,
            (conflicting.event_id, conflicting.event_id, CV_ID),
        ).fetchone()
    assert conflicting_rows == (0, 0, CANDIDATE_ID)


@pytest.mark.parametrize(
    ("action", "tombstone", "sequence"),
    (("DEACTIVATED", False, 12), ("DELETED", True, 14)),
)
def test_terminal_first_binds_durable_owner_and_rejects_reassignment(
    database_url: str,
    action: str,
    tombstone: bool,
    sequence: int,
) -> None:
    repository = PsycopgIngestionRepository(database_url)
    first = event(sequence, action=action, version=1, state="terminal-first")
    assert (
        repository.deactivate_cv(
            CvDeactivation(first, CV_ID, CANDIDATE_ID, tombstone=tombstone)
        )
        is IngestionOutcome.APPLIED
    )

    conflicting = event(
        sequence + 1,
        action=action,
        version=2,
        state="terminal-other-owner",
    )
    with pytest.raises(
        IngestionContractError,
        match="already owned by another candidate",
    ):
        repository.deactivate_cv(
            CvDeactivation(
                conflicting,
                CV_ID,
                OTHER_CANDIDATE_ID,
                tombstone=tombstone,
            )
        )

    with psycopg.connect(database_url) as connection:
        state = connection.execute(
            """
            SELECT
                (SELECT user_id FROM ai.cv_aggregate_owners WHERE cv_id = %s),
                (SELECT count(*) FROM ai.cv_embeddings WHERE cv_id = %s),
                (SELECT last_aggregate_version FROM ai.embedding_aggregate_cursors
                    WHERE aggregate_type = 'CV' AND aggregate_id = %s),
                (SELECT count(*) FROM ai.embedding_event_ledger
                    WHERE event_id = %s)
            """,
            (CV_ID, CV_ID, CV_ID, conflicting.event_id),
        ).fetchone()
    assert state == (CANDIDATE_ID, 0, 1, 0)


@pytest.mark.parametrize(
    ("statement", "parameters"),
    (
        (
            "UPDATE ai.cv_aggregate_owners SET user_id = %s WHERE cv_id = %s",
            (OTHER_CANDIDATE_ID, CV_ID),
        ),
        (
            "DELETE FROM ai.cv_aggregate_owners WHERE cv_id = %s AND user_id = %s",
            (CV_ID, CANDIDATE_ID),
        ),
    ),
)
def test_owner_registry_rejects_direct_update_and_delete(
    database_url: str,
    statement: str,
    parameters: tuple[UUID, UUID],
) -> None:
    repository = PsycopgIngestionRepository(database_url)
    original = event(18, action="UPSERTED", version=1, state="owned")
    assert repository.upsert_cv(write(original)) is IngestionOutcome.APPLIED

    with psycopg.connect(database_url) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(statement, parameters)

    with psycopg.connect(database_url) as connection:
        owner = connection.execute(
            "SELECT user_id FROM ai.cv_aggregate_owners WHERE cv_id = %s",
            (CV_ID,),
        ).fetchone()
    assert owner == (CANDIDATE_ID,)


def test_cv_id_cannot_be_reassigned_to_another_candidate(
    database_url: str,
) -> None:
    repository = PsycopgIngestionRepository(database_url)
    original = event(20, action="UPSERTED", version=1, state="owned")
    assert repository.upsert_cv(write(original)) is IngestionOutcome.APPLIED

    reassigned = event(21, action="UPSERTED", version=2, state="reassigned")
    with pytest.raises(
        IngestionContractError,
        match="already owned by another candidate",
    ):
        repository.upsert_cv(
            replace(
                write(reassigned),
                candidate_id=UUID("30000000-0000-0000-0000-000000000099"),
            )
        )

    with psycopg.connect(database_url) as connection:
        state = connection.execute(
            """
            SELECT
                (SELECT user_id FROM ai.cv_embeddings WHERE cv_id = %s),
                (SELECT user_id FROM ai.cv_aggregate_owners WHERE cv_id = %s),
                (SELECT last_aggregate_version FROM ai.embedding_aggregate_cursors
                    WHERE aggregate_type = 'CV' AND aggregate_id = %s),
                (SELECT count(*) FROM ai.embedding_event_ledger
                    WHERE event_id = %s)
            """,
            (CV_ID, CV_ID, CV_ID, reassigned.event_id),
        ).fetchone()
    assert state == (CANDIDATE_ID, CANDIDATE_ID, 1, 0)


def event(
    sequence: int,
    *,
    action: str,
    version: int,
    state: str,
) -> IngestionEvent:
    return IngestionEvent(
        event_id=UUID(f"10000000-0000-4000-8000-{sequence:012d}"),
        topic="cv-events",
        partition=0,
        offset=sequence,
        aggregate_type="CV",
        aggregate_id=CV_ID,
        action=action,
        occurred_at=BASE_TIME + timedelta(seconds=sequence),
        payload_hash=digest(f"payload-{sequence}"),
        state_hash=digest(state),
        schema_version=1,
        aggregate_version=version,
    )


def write(source: IngestionEvent) -> CvEmbeddingWrite:
    return CvEmbeddingWrite(
        event=source,
        cv_id=CV_ID,
        candidate_id=CANDIDATE_ID,
        vector=VECTOR,
        text_hash=digest("private-text-never-stored"),
        model_name=MODEL,
        is_active=True,
    )


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
