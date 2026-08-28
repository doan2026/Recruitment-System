"""Transactional PostgreSQL state for idempotent embedding ingestion."""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import UUID

import psycopg
from psycopg import Connection, Cursor

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_ERROR_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
_JOB_ACTIONS = frozenset({"CREATED", "UPDATED", "CLOSED", "EXPIRED", "DELETED"})
_CV_ACTIONS = frozenset({"UPSERTED", "DEACTIVATED", "DELETED"})
_VECTOR_DIMENSIONS = 384

_MAX_BIGINT = 9_223_372_036_854_775_807
_MAX_MONEY = Decimal("9999999999999.99")
_MONEY_QUANTUM = Decimal("0.01")


class IngestionOutcome(StrEnum):
    APPLIED = "APPLIED"
    SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"
    SKIPPED_STALE = "SKIPPED_STALE"
    SKIPPED_UNCHANGED = "SKIPPED_UNCHANGED"
    DEAD_LETTER = "DEAD_LETTER"


class IngestionRepositoryUnavailable(RuntimeError):
    """Raised when PostgreSQL cannot safely persist an ingestion result."""


class IngestionContractError(ValueError):
    """Base class for invalid or contradictory event metadata."""


class EventIdentityConflict(IngestionContractError):
    """The producer reused an event ID with a different canonical payload."""


class TransportIdentityConflict(IngestionContractError):
    """A topic/partition/offset was reused for a different event."""


class EventOrderingConflict(IngestionContractError):
    """Two events cannot be ordered safely from the supplied source metadata."""


class EmbeddingRequired(IngestionContractError):
    """An upsert did not contain a usable 384-dimensional embedding."""


@dataclass(frozen=True, slots=True)
class IngestionEvent:
    event_id: UUID
    topic: str
    partition: int
    offset: int
    aggregate_type: str
    aggregate_id: UUID
    action: str
    occurred_at: datetime
    payload_hash: str
    state_hash: str
    schema_version: int = 1
    aggregate_version: int | None = None


@dataclass(frozen=True, slots=True)
class JobEmbeddingWrite:
    event: IngestionEvent
    job_id: UUID
    vector: Sequence[float]
    text_hash: str
    model_name: str
    location: str | None = None
    salary_min: Decimal | None = None
    salary_max: Decimal | None = None
    job_type: str | None = None
    is_active: bool = False


@dataclass(frozen=True, slots=True)
class JobDeactivation:
    event: IngestionEvent
    job_id: UUID
    tombstone: bool = False


@dataclass(frozen=True, slots=True)
class CvEmbeddingWrite:
    event: IngestionEvent
    cv_id: UUID
    candidate_id: UUID
    vector: Sequence[float]
    text_hash: str
    model_name: str
    is_active: bool = True


@dataclass(frozen=True, slots=True)
class CvDeactivation:
    event: IngestionEvent
    cv_id: UUID
    candidate_id: UUID
    tombstone: bool = False


@dataclass(frozen=True, slots=True)
class _AggregateCursor:
    event_id: UUID
    aggregate_version: int | None
    occurred_at: datetime
    state_hash: str
    topic: str
    partition: int
    offset: int
    action: str
    tombstoned: bool


@dataclass(frozen=True, slots=True)
class _OrderingDecision:
    outcome: IngestionOutcome
    advance_cursor: bool


class PsycopgIngestionRepository:
    """Persist terminal Kafka outcomes and embedding changes atomically.

    The repository deliberately accepts only hashes and sanitized failure details;
    raw Kafka payloads, CV text and job descriptions have no persistence API here.
    """

    def __init__(
        self,
        database_url: str,
        *,
        connect_timeout_seconds: int = 2,
        statement_timeout_ms: int = 10_000,
    ) -> None:
        self._database_url = database_url
        self._connect_timeout_seconds = connect_timeout_seconds
        self._statement_timeout_ms = statement_timeout_ms

    def lookup_event(
        self,
        event_id: UUID,
        payload_hash: str,
    ) -> IngestionOutcome | None:
        """Return a terminal result before expensive model inference.

        A repeated ID is idempotent only when the canonical payload hash also
        matches. Reusing an ID for different data is a producer contract error.
        """

        _require_hash("payload_hash", payload_hash)
        try:
            with self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT payload_hash, outcome
                    FROM ai.embedding_event_ledger
                    WHERE event_id = %s
                    """,
                    (event_id,),
                ).fetchone()
        except psycopg.Error as error:
            raise IngestionRepositoryUnavailable from error

        if row is None:
            return None
        if row[0] != payload_hash:
            raise EventIdentityConflict(
                "event_id was already used with a different payload hash"
            )
        return IngestionOutcome(row[1])

    def is_terminal_event(self, event_id: UUID, payload_hash: str) -> bool:
        return self.lookup_event(event_id, payload_hash) is not None

    def upsert_job(self, write: JobEmbeddingWrite) -> IngestionOutcome:
        event = _validate_job_event(write.event, write.job_id)
        _require_hash("text_hash", write.text_hash)
        model_name = _required_text("model_name", write.model_name, maximum=128)
        location = _optional_text("location", write.location, maximum=255)
        job_type = _optional_text("job_type", write.job_type, maximum=50)
        salary_min = _validate_salary("salary_min", write.salary_min)
        salary_max = _validate_salary("salary_max", write.salary_max)
        if (
            salary_min is not None
            and salary_max is not None
            and salary_max < salary_min
        ):
            raise IngestionContractError("salary_max must be greater than salary_min")
        vector = _vector_literal(write.vector)

        def operation(cursor: Cursor[Any]) -> IngestionOutcome:
            self._lock_aggregate(cursor, event)
            duplicate = self._find_duplicate(cursor, event)
            if duplicate is not None:
                return duplicate
            self._require_unused_transport(cursor, event)
            current = self._load_cursor(cursor, event)
            decision = _decide_order(current, event, target_tombstone=False)
            if decision.outcome is IngestionOutcome.SKIPPED_STALE:
                self._insert_ledger(cursor, event, decision.outcome, write.text_hash)
                return decision.outcome
            if decision.outcome is IngestionOutcome.SKIPPED_UNCHANGED:
                if decision.advance_cursor:
                    self._write_cursor(cursor, event, tombstoned=False)
                self._insert_ledger(cursor, event, decision.outcome, write.text_hash)
                return decision.outcome

            cursor.execute(
                """
                INSERT INTO ai.job_embeddings (
                    job_id,
                    vector,
                    text_hash,
                    model_name,
                    location,
                    salary_min,
                    salary_max,
                    job_type,
                    is_active,
                    updated_at,
                    source_event_id,
                    source_version,
                    source_occurred_at
                ) VALUES (
                    %s, %s::vector, %s, %s, %s, %s, %s, %s, %s,
                    CURRENT_TIMESTAMP, %s, %s, %s
                )
                ON CONFLICT (job_id) DO UPDATE SET
                    vector = EXCLUDED.vector,
                    text_hash = EXCLUDED.text_hash,
                    model_name = EXCLUDED.model_name,
                    location = EXCLUDED.location,
                    salary_min = EXCLUDED.salary_min,
                    salary_max = EXCLUDED.salary_max,
                    job_type = EXCLUDED.job_type,
                    is_active = EXCLUDED.is_active,
                    updated_at = CURRENT_TIMESTAMP,
                    source_event_id = EXCLUDED.source_event_id,
                    source_version = EXCLUDED.source_version,
                    source_occurred_at = EXCLUDED.source_occurred_at
                """,
                (
                    write.job_id,
                    vector,
                    write.text_hash,
                    model_name,
                    location,
                    salary_min,
                    salary_max,
                    job_type,
                    write.is_active,
                    event.event_id,
                    event.aggregate_version,
                    event.occurred_at,
                ),
            )
            self._write_cursor(cursor, event, tombstoned=False)
            self._insert_ledger(
                cursor,
                event,
                IngestionOutcome.APPLIED,
                write.text_hash,
            )
            return IngestionOutcome.APPLIED

        return self._write(operation)

    def deactivate_job(self, command: JobDeactivation) -> IngestionOutcome:
        event = _validate_job_event(command.event, command.job_id)

        def operation(cursor: Cursor[Any]) -> IngestionOutcome:
            self._lock_aggregate(cursor, event)
            duplicate = self._find_duplicate(cursor, event)
            if duplicate is not None:
                return duplicate
            self._require_unused_transport(cursor, event)
            current = self._load_cursor(cursor, event)
            decision = _decide_order(
                current,
                event,
                target_tombstone=command.tombstone,
            )
            if decision.outcome is IngestionOutcome.SKIPPED_STALE:
                self._insert_ledger(cursor, event, decision.outcome, None)
                return decision.outcome
            if decision.outcome is IngestionOutcome.SKIPPED_UNCHANGED:
                if decision.advance_cursor:
                    self._write_cursor(
                        cursor,
                        event,
                        tombstoned=command.tombstone,
                    )
                self._insert_ledger(cursor, event, decision.outcome, None)
                return decision.outcome

            if command.tombstone:
                cursor.execute(
                    "DELETE FROM ai.job_embeddings WHERE job_id = %s",
                    (command.job_id,),
                )
            else:
                cursor.execute(
                    """
                    UPDATE ai.job_embeddings
                    SET is_active = FALSE,
                        updated_at = CURRENT_TIMESTAMP,
                        source_event_id = %s,
                        source_version = %s,
                        source_occurred_at = %s
                    WHERE job_id = %s
                    """,
                    (
                        event.event_id,
                        event.aggregate_version,
                        event.occurred_at,
                        command.job_id,
                    ),
                )
            self._write_cursor(
                cursor,
                event,
                tombstoned=command.tombstone,
            )
            self._insert_ledger(cursor, event, IngestionOutcome.APPLIED, None)
            return IngestionOutcome.APPLIED

        return self._write(operation)

    def upsert_cv(self, write: CvEmbeddingWrite) -> IngestionOutcome:
        event = _validate_cv_event(write.event, write.cv_id)
        if event.action != "UPSERTED" or write.is_active is not True:
            raise IngestionContractError("CV upsert must be an active UPSERTED event")
        _require_hash("text_hash", write.text_hash)
        model_name = _required_text("model_name", write.model_name, maximum=128)
        vector = _vector_literal(write.vector)

        def operation(cursor: Cursor[Any]) -> IngestionOutcome:
            self._lock_aggregate(cursor, event)
            self._bind_cv_owner(cursor, write.cv_id, write.candidate_id)
            duplicate = self._find_duplicate(cursor, event)
            if duplicate is not None:
                return duplicate
            self._require_unused_transport(cursor, event)
            current = self._load_cursor(cursor, event)
            decision = (
                _OrderingDecision(IngestionOutcome.SKIPPED_STALE, False)
                if current is not None and current.action == "DEACTIVATED"
                else _decide_order(current, event, target_tombstone=False)
            )
            if decision.outcome is IngestionOutcome.SKIPPED_STALE:
                self._insert_ledger(cursor, event, decision.outcome, write.text_hash)
                return decision.outcome
            if decision.outcome is IngestionOutcome.SKIPPED_UNCHANGED:
                if decision.advance_cursor:
                    self._write_cursor(cursor, event, tombstoned=False)
                self._insert_ledger(cursor, event, decision.outcome, write.text_hash)
                return decision.outcome

            cursor.execute(
                """
                INSERT INTO ai.cv_embeddings (
                    cv_id,
                    user_id,
                    vector,
                    text_hash,
                    model_name,
                    is_active,
                    updated_at,
                    source_event_id,
                    source_version,
                    source_occurred_at
                ) VALUES (
                    %s, %s, %s::vector, %s, %s, TRUE, CURRENT_TIMESTAMP,
                    %s, %s, %s
                )
                ON CONFLICT (cv_id) DO UPDATE SET
                    vector = EXCLUDED.vector,
                    text_hash = EXCLUDED.text_hash,
                    model_name = EXCLUDED.model_name,
                    is_active = TRUE,
                    updated_at = CURRENT_TIMESTAMP,
                    source_event_id = EXCLUDED.source_event_id,
                    source_version = EXCLUDED.source_version,
                    source_occurred_at = EXCLUDED.source_occurred_at
                WHERE ai.cv_embeddings.user_id = EXCLUDED.user_id
                """,
                (
                    write.cv_id,
                    write.candidate_id,
                    vector,
                    write.text_hash,
                    model_name,
                    event.event_id,
                    event.aggregate_version,
                    event.occurred_at,
                ),
            )
            if cursor.rowcount != 1:
                raise IngestionContractError(
                    "cv_id is already owned by another candidate"
                )
            self._write_cursor(cursor, event, tombstoned=False)
            self._insert_ledger(
                cursor,
                event,
                IngestionOutcome.APPLIED,
                write.text_hash,
            )
            return IngestionOutcome.APPLIED

        return self._write(operation)

    def deactivate_cv(self, command: CvDeactivation) -> IngestionOutcome:
        event = _validate_cv_event(command.event, command.cv_id)
        expected_action = "DELETED" if command.tombstone else "DEACTIVATED"
        if event.action != expected_action:
            raise IngestionContractError("CV deactivation action is inconsistent")

        def operation(cursor: Cursor[Any]) -> IngestionOutcome:
            self._lock_aggregate(cursor, event)
            self._bind_cv_owner(cursor, command.cv_id, command.candidate_id)
            duplicate = self._find_duplicate(cursor, event)
            if duplicate is not None:
                return duplicate
            self._require_unused_transport(cursor, event)
            current = self._load_cursor(cursor, event)
            decision = _decide_order(
                current,
                event,
                target_tombstone=command.tombstone,
            )
            if decision.outcome is IngestionOutcome.SKIPPED_STALE:
                self._insert_ledger(cursor, event, decision.outcome, None)
                return decision.outcome
            if decision.outcome is IngestionOutcome.SKIPPED_UNCHANGED:
                if decision.advance_cursor:
                    self._write_cursor(
                        cursor,
                        event,
                        tombstoned=command.tombstone,
                    )
                self._insert_ledger(cursor, event, decision.outcome, None)
                return decision.outcome

            if command.tombstone:
                cursor.execute(
                    "DELETE FROM ai.cv_embeddings WHERE cv_id = %s",
                    (command.cv_id,),
                )
            else:
                cursor.execute(
                    """
                    UPDATE ai.cv_embeddings
                    SET is_active = FALSE,
                        updated_at = CURRENT_TIMESTAMP,
                        source_event_id = %s,
                        source_version = %s,
                        source_occurred_at = %s
                    WHERE cv_id = %s
                    """,
                    (
                        event.event_id,
                        event.aggregate_version,
                        event.occurred_at,
                        command.cv_id,
                    ),
                )
            self._write_cursor(cursor, event, tombstoned=command.tombstone)
            self._insert_ledger(cursor, event, IngestionOutcome.APPLIED, None)
            return IngestionOutcome.APPLIED

        return self._write(operation)

    def dead_letter_cv(
        self,
        event: IngestionEvent,
        cv_id: UUID,
        candidate_id: UUID,
        *,
        error_code: str,
        safe_message: str,
        attempt_count: int,
    ) -> IngestionOutcome:
        event = _validate_cv_event(event, cv_id)
        error_code, message, attempt_count = _validate_dead_letter_details(
            error_code,
            safe_message,
            attempt_count,
        )

        def operation(cursor: Cursor[Any]) -> IngestionOutcome:
            self._lock_aggregate(cursor, event)
            self._bind_cv_owner(cursor, cv_id, candidate_id)
            existing = cursor.execute(
                """
                SELECT payload_hash, outcome
                FROM ai.embedding_event_ledger
                WHERE event_id = %s
                FOR UPDATE
                """,
                (event.event_id,),
            ).fetchone()
            if existing is not None:
                if existing[0] != event.payload_hash:
                    raise EventIdentityConflict(
                        "event_id was already used with a different payload hash"
                    )
                outcome = IngestionOutcome(existing[1])
                if outcome is IngestionOutcome.DEAD_LETTER:
                    return outcome
                return IngestionOutcome.SKIPPED_DUPLICATE

            self._require_unused_transport(cursor, event)
            transport = cursor.execute(
                """
                SELECT event_id, payload_hash
                FROM ai.embedding_dead_letters
                WHERE topic = %s
                  AND kafka_partition = %s
                  AND kafka_offset = %s
                FOR UPDATE
                """,
                (event.topic, event.partition, event.offset),
            ).fetchone()
            if transport is not None:
                if transport == (event.event_id, event.payload_hash):
                    return IngestionOutcome.DEAD_LETTER
                raise TransportIdentityConflict(
                    "Kafka position was already dead-lettered for another event"
                )
            cursor.execute(
                """
                INSERT INTO ai.embedding_dead_letters (
                    event_id, topic, kafka_partition, kafka_offset, key_hash,
                    aggregate_type, aggregate_id, action, payload_hash,
                    error_code, error_message, attempt_count
                ) VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event.event_id,
                    event.topic,
                    event.partition,
                    event.offset,
                    event.aggregate_type,
                    event.aggregate_id,
                    event.action,
                    event.payload_hash,
                    error_code,
                    message,
                    attempt_count,
                ),
            )
            self._insert_ledger(
                cursor,
                event,
                IngestionOutcome.DEAD_LETTER,
                None,
            )
            return IngestionOutcome.DEAD_LETTER

        return self._write(operation)

    def dead_letter_job(
        self,
        event: IngestionEvent,
        job_id: UUID,
        *,
        error_code: str,
        safe_message: str,
        attempt_count: int,
    ) -> IngestionOutcome:
        event = _validate_job_event(event, job_id)
        error_code, message, attempt_count = _validate_dead_letter_details(
            error_code, safe_message, attempt_count
        )

        def operation(cursor: Cursor[Any]) -> IngestionOutcome:
            self._lock_aggregate(cursor, event)
            existing = cursor.execute(
                """
                SELECT payload_hash, outcome
                FROM ai.embedding_event_ledger
                WHERE event_id = %s
                FOR UPDATE
                """,
                (event.event_id,),
            ).fetchone()
            if existing is not None:
                if existing[0] != event.payload_hash:
                    raise EventIdentityConflict(
                        "event_id was already used with a different payload hash"
                    )
                outcome = IngestionOutcome(existing[1])
                if outcome is IngestionOutcome.DEAD_LETTER:
                    return outcome
                return IngestionOutcome.SKIPPED_DUPLICATE

            self._require_unused_transport(cursor, event)

            transport = cursor.execute(
                """
                SELECT event_id, payload_hash
                FROM ai.embedding_dead_letters
                WHERE topic = %s
                  AND kafka_partition = %s
                  AND kafka_offset = %s
                FOR UPDATE
                """,
                (event.topic, event.partition, event.offset),
            ).fetchone()
            if transport is not None:
                if transport == (event.event_id, event.payload_hash):
                    return IngestionOutcome.DEAD_LETTER
                raise TransportIdentityConflict(
                    "Kafka position was already dead-lettered for another event"
                )

            cursor.execute(
                """
                INSERT INTO ai.embedding_dead_letters (
                    event_id,
                    topic,
                    kafka_partition,
                    kafka_offset,
                    key_hash,
                    aggregate_type,
                    aggregate_id,
                    action,
                    payload_hash,
                    error_code,
                    error_message,
                    attempt_count
                ) VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event.event_id,
                    event.topic,
                    event.partition,
                    event.offset,
                    event.aggregate_type,
                    event.aggregate_id,
                    event.action,
                    event.payload_hash,
                    error_code,
                    message,
                    attempt_count,
                ),
            )
            if existing is None:
                self._insert_ledger(
                    cursor,
                    event,
                    IngestionOutcome.DEAD_LETTER,
                    None,
                )
            return IngestionOutcome.DEAD_LETTER

        return self._write(operation)

    def record_transport_dead_letter(
        self,
        *,
        topic: str,
        partition: int,
        offset: int,
        key_hash: str | None,
        payload_hash: str,
        error_code: str,
        attempt_count: int,
        safe_message: str | None = None,
    ) -> IngestionOutcome:
        """Persist sanitized transport metadata for an unparseable message."""

        topic = _required_text("topic", topic, maximum=100)
        if isinstance(partition, bool) or partition < 0:
            raise IngestionContractError("partition must be non-negative")
        if isinstance(offset, bool) or offset < 0:
            raise IngestionContractError("offset must be non-negative")
        if key_hash is not None:
            _require_hash("key_hash", key_hash)
        _require_hash("payload_hash", payload_hash)
        error_code, message, attempt_count = _validate_dead_letter_details(
            error_code,
            safe_message or error_code,
            attempt_count,
        )

        def operation(cursor: Cursor[Any]) -> IngestionOutcome:
            existing = cursor.execute(
                """
                SELECT key_hash, payload_hash, error_code
                FROM ai.embedding_dead_letters
                WHERE topic = %s
                  AND kafka_partition = %s
                  AND kafka_offset = %s
                FOR UPDATE
                """,
                (topic, partition, offset),
            ).fetchone()
            identity = (key_hash, payload_hash, error_code)
            if existing is not None:
                if existing == identity:
                    return IngestionOutcome.DEAD_LETTER
                raise TransportIdentityConflict(
                    "Kafka position was already dead-lettered with other hashes"
                )
            cursor.execute(
                """
                INSERT INTO ai.embedding_dead_letters (
                    event_id,
                    topic,
                    kafka_partition,
                    kafka_offset,
                    key_hash,
                    aggregate_type,
                    aggregate_id,
                    action,
                    payload_hash,
                    error_code,
                    error_message,
                    attempt_count
                ) VALUES (
                    NULL, %s, %s, %s, %s, NULL, NULL, NULL, %s, %s, %s, %s
                )
                """,
                (
                    topic,
                    partition,
                    offset,
                    key_hash,
                    payload_hash,
                    error_code,
                    message,
                    attempt_count,
                ),
            )
            return IngestionOutcome.DEAD_LETTER

        return self._write(operation)

    def _connect(self) -> Connection[Any]:
        return psycopg.connect(
            self._database_url,
            connect_timeout=self._connect_timeout_seconds,
        )

    def _write(self, operation: Any) -> IngestionOutcome:
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._set_statement_timeout(cursor)
                    return operation(cursor)
        except IngestionContractError:
            raise
        except psycopg.Error as error:
            raise IngestionRepositoryUnavailable from error

    def _set_statement_timeout(self, cursor: Cursor[Any]) -> None:
        cursor.execute(
            "SELECT set_config('statement_timeout', %s, true)",
            (str(self._statement_timeout_ms),),
        )

    def _lock_aggregate(self, cursor: Cursor[Any], event: IngestionEvent) -> None:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            (f"{event.aggregate_type}:{event.aggregate_id}",),
        )

    def _bind_cv_owner(
        self,
        cursor: Cursor[Any],
        cv_id: UUID,
        candidate_id: UUID,
    ) -> None:
        cursor.execute(
            """
            INSERT INTO ai.cv_aggregate_owners (cv_id, user_id)
            VALUES (%s, %s)
            ON CONFLICT (cv_id) DO NOTHING
            """,
            (cv_id, candidate_id),
        )
        owner = cursor.execute(
            """
            SELECT user_id
            FROM ai.cv_aggregate_owners
            WHERE cv_id = %s
            FOR UPDATE
            """,
            (cv_id,),
        ).fetchone()
        if owner is None or owner[0] != candidate_id:
            raise IngestionContractError("cv_id is already owned by another candidate")

    def _find_duplicate(
        self,
        cursor: Cursor[Any],
        event: IngestionEvent,
    ) -> IngestionOutcome | None:
        row = cursor.execute(
            """
            SELECT payload_hash
            FROM ai.embedding_event_ledger
            WHERE event_id = %s
            FOR UPDATE
            """,
            (event.event_id,),
        ).fetchone()
        if row is None:
            return None
        if row[0] != event.payload_hash:
            raise EventIdentityConflict(
                "event_id was already used with a different payload hash"
            )
        return IngestionOutcome.SKIPPED_DUPLICATE

    def _require_unused_transport(
        self,
        cursor: Cursor[Any],
        event: IngestionEvent,
    ) -> None:
        row = cursor.execute(
            """
            SELECT event_id, payload_hash
            FROM ai.embedding_event_ledger
            WHERE topic = %s
              AND kafka_partition = %s
              AND kafka_offset = %s
            FOR UPDATE
            """,
            (event.topic, event.partition, event.offset),
        ).fetchone()
        if row is not None and row != (event.event_id, event.payload_hash):
            raise TransportIdentityConflict(
                "Kafka position was already used for another event"
            )

    def _load_cursor(
        self,
        cursor: Cursor[Any],
        event: IngestionEvent,
    ) -> _AggregateCursor | None:
        row = cursor.execute(
            """
            SELECT
                last_event_id,
                last_aggregate_version,
                last_occurred_at,
                last_state_hash,
                last_topic,
                last_kafka_partition,
                last_kafka_offset,
                last_action,
                tombstoned
            FROM ai.embedding_aggregate_cursors
            WHERE aggregate_type = %s AND aggregate_id = %s
            FOR UPDATE
            """,
            (event.aggregate_type, event.aggregate_id),
        ).fetchone()
        if row is None:
            return None
        return _AggregateCursor(*row)

    def _write_cursor(
        self,
        cursor: Cursor[Any],
        event: IngestionEvent,
        *,
        tombstoned: bool,
    ) -> None:
        cursor.execute(
            """
            INSERT INTO ai.embedding_aggregate_cursors (
                aggregate_type,
                aggregate_id,
                last_event_id,
                last_aggregate_version,
                last_occurred_at,
                last_state_hash,
                last_topic,
                last_kafka_partition,
                last_kafka_offset,
                last_action,
                tombstoned,
                updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      CURRENT_TIMESTAMP)
            ON CONFLICT (aggregate_type, aggregate_id) DO UPDATE SET
                last_event_id = EXCLUDED.last_event_id,
                last_aggregate_version = EXCLUDED.last_aggregate_version,
                last_occurred_at = EXCLUDED.last_occurred_at,
                last_state_hash = EXCLUDED.last_state_hash,
                last_topic = EXCLUDED.last_topic,
                last_kafka_partition = EXCLUDED.last_kafka_partition,
                last_kafka_offset = EXCLUDED.last_kafka_offset,
                last_action = EXCLUDED.last_action,
                tombstoned = EXCLUDED.tombstoned,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                event.aggregate_type,
                event.aggregate_id,
                event.event_id,
                event.aggregate_version,
                event.occurred_at,
                event.state_hash,
                event.topic,
                event.partition,
                event.offset,
                event.action,
                tombstoned,
            ),
        )

    def _insert_ledger(
        self,
        cursor: Cursor[Any],
        event: IngestionEvent,
        outcome: IngestionOutcome,
        text_hash: str | None,
    ) -> None:
        cursor.execute(
            """
            INSERT INTO ai.embedding_event_ledger (
                event_id,
                topic,
                kafka_partition,
                kafka_offset,
                aggregate_type,
                aggregate_id,
                action,
                schema_version,
                aggregate_version,
                occurred_at,
                payload_hash,
                state_hash,
                text_hash,
                outcome
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s, %s)
            """,
            (
                event.event_id,
                event.topic,
                event.partition,
                event.offset,
                event.aggregate_type,
                event.aggregate_id,
                event.action,
                event.schema_version,
                event.aggregate_version,
                event.occurred_at,
                event.payload_hash,
                event.state_hash,
                text_hash,
                outcome.value,
            ),
        )


def _validate_job_event(event: IngestionEvent, job_id: UUID) -> IngestionEvent:
    if event.aggregate_type != "JOB":
        raise IngestionContractError("aggregate_type must be JOB")
    if event.aggregate_id != job_id:
        raise IngestionContractError("aggregate_id must match job_id")
    _required_text("topic", event.topic, maximum=100)
    if event.action not in _JOB_ACTIONS:
        raise IngestionContractError("unsupported job event action")
    if isinstance(event.partition, bool) or event.partition < 0:
        raise IngestionContractError("partition must be non-negative")
    if isinstance(event.offset, bool) or event.offset < 0:
        raise IngestionContractError("offset must be non-negative")
    if event.occurred_at.utcoffset() is None:
        raise IngestionContractError("occurred_at must include a UTC offset")
    if isinstance(event.schema_version, bool) or event.schema_version <= 0:
        raise IngestionContractError("schema_version must be positive")
    if event.aggregate_version is not None and (
        isinstance(event.aggregate_version, bool)
        or event.aggregate_version < 0
        or event.aggregate_version > _MAX_BIGINT
    ):
        raise IngestionContractError(
            "aggregate_version must be non-negative and fit PostgreSQL BIGINT"
        )
    _require_hash("payload_hash", event.payload_hash)
    _require_hash("state_hash", event.state_hash)
    return event


def _validate_cv_event(event: IngestionEvent, cv_id: UUID) -> IngestionEvent:
    if event.aggregate_type != "CV":
        raise IngestionContractError("aggregate_type must be CV")
    if event.aggregate_id != cv_id:
        raise IngestionContractError("aggregate_id must match cv_id")
    _required_text("topic", event.topic, maximum=100)
    if event.action not in _CV_ACTIONS:
        raise IngestionContractError("unsupported CV event action")
    if isinstance(event.partition, bool) or event.partition < 0:
        raise IngestionContractError("partition must be non-negative")
    if isinstance(event.offset, bool) or event.offset < 0:
        raise IngestionContractError("offset must be non-negative")
    if event.occurred_at.utcoffset() is None:
        raise IngestionContractError("occurred_at must include a UTC offset")
    if event.schema_version != 1:
        raise IngestionContractError("schema_version must be 1 for CV events")
    if (
        isinstance(event.aggregate_version, bool)
        or event.aggregate_version is None
        or event.aggregate_version <= 0
        or event.aggregate_version > _MAX_BIGINT
    ):
        raise IngestionContractError(
            "CV aggregate_version must be positive and fit PostgreSQL BIGINT"
        )
    _require_hash("payload_hash", event.payload_hash)
    _require_hash("state_hash", event.state_hash)
    return event


def _decide_order(
    current: _AggregateCursor | None,
    event: IngestionEvent,
    *,
    target_tombstone: bool,
) -> _OrderingDecision:
    if current is None:
        return _OrderingDecision(IngestionOutcome.APPLIED, True)
    if current.tombstoned and not target_tombstone:
        return _OrderingDecision(IngestionOutcome.SKIPPED_STALE, False)

    comparison = _compare_position(current, event)
    if comparison < 0:
        return _OrderingDecision(IngestionOutcome.SKIPPED_STALE, False)
    if comparison == 0:
        if current.state_hash != event.state_hash:
            raise EventOrderingConflict(
                "events at the same source version have different state hashes"
            )
        return _OrderingDecision(IngestionOutcome.SKIPPED_UNCHANGED, False)
    if current.state_hash == event.state_hash and (
        current.tombstoned == target_tombstone
    ):
        return _OrderingDecision(IngestionOutcome.SKIPPED_UNCHANGED, True)
    return _OrderingDecision(IngestionOutcome.APPLIED, True)


def _compare_position(current: _AggregateCursor, event: IngestionEvent) -> int:
    if current.aggregate_version is not None:
        if event.aggregate_version is None:
            return -1
        return _compare(event.aggregate_version, current.aggregate_version)

    legacy = _compare_legacy_position(current, event)
    if event.aggregate_version is not None:
        return legacy
    return legacy


def _compare_legacy_position(
    current: _AggregateCursor,
    event: IngestionEvent,
) -> int:
    time_comparison = _compare(event.occurred_at, current.occurred_at)
    if time_comparison != 0:
        return time_comparison
    if event.topic != current.topic or event.partition != current.partition:
        raise EventOrderingConflict(
            "legacy events with equal timestamps must share topic and partition"
        )
    return _compare(event.offset, current.offset)


def _compare(left: Any, right: Any) -> int:
    return (left > right) - (left < right)


def _vector_literal(values: Sequence[float]) -> str:
    if len(values) != _VECTOR_DIMENSIONS:
        raise EmbeddingRequired("embedding must contain exactly 384 dimensions")
    normalized: list[float] = []
    for value in values:
        if isinstance(value, bool):
            raise EmbeddingRequired("embedding values must be finite numbers")
        try:
            number = float(value)
        except (TypeError, ValueError) as error:
            raise EmbeddingRequired(
                "embedding values must be finite numbers"
            ) from error
        if not math.isfinite(number):
            raise EmbeddingRequired("embedding values must be finite numbers")
        normalized.append(number)
    if not any(number != 0.0 for number in normalized):
        raise EmbeddingRequired("embedding must not be a zero vector")
    return "[" + ",".join(format(number, ".17g") for number in normalized) + "]"


def _validate_salary(name: str, value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    if not isinstance(value, Decimal) or not value.is_finite() or value < 0:
        raise IngestionContractError(f"{name} must be a non-negative Decimal")
    if value > _MAX_MONEY or value != value.quantize(_MONEY_QUANTUM):
        raise IngestionContractError(
            f"{name} must fit PostgreSQL NUMERIC(15, 2) without rounding"
        )
    return value


def _validate_dead_letter_details(
    error_code: str,
    safe_message: str,
    attempt_count: int,
) -> tuple[str, str, int]:
    if not _ERROR_CODE_PATTERN.fullmatch(error_code):
        raise IngestionContractError("error_code must be stable upper snake case")
    message = " ".join(safe_message.split())[:500]
    if not message:
        raise IngestionContractError("safe_message must not be blank")
    if isinstance(attempt_count, bool) or attempt_count <= 0:
        raise IngestionContractError("attempt_count must be positive")
    return error_code, message, attempt_count


def _require_hash(name: str, value: str) -> str:
    if not _HASH_PATTERN.fullmatch(value):
        raise IngestionContractError(f"{name} must be a lowercase SHA-256 hash")
    return value


def _required_text(name: str, value: str, *, maximum: int) -> str:
    normalized = value.strip()
    if not normalized or len(normalized) > maximum:
        raise IngestionContractError(
            f"{name} must contain 1 to {maximum} non-blank characters"
        )
    return normalized


def _optional_text(name: str, value: str | None, *, maximum: int) -> str | None:
    if value is None:
        return None
    return _required_text(name, value, maximum=maximum)
