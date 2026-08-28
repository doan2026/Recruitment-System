#!/usr/bin/env python3
"""Controlled correctness and load gate for candidate recommendation queries."""

from __future__ import annotations

import concurrent.futures
import json
import math
import os
import re
import struct
import time
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import psycopg
from alembic import command
from alembic.config import Config

from app.recommendation import (
    CandidateEligibility,
    CandidateRecommendationFilters,
    RecommendationBoundary,
    StaleRecommendationCursor,
)
from app.recommendation_repository import (
    PsycopgRecommendationRepository,
    _candidate_rows_query,
)

DATASET_SIZE = 100_000
ACTIVE_MODEL_A = 80_000
INACTIVE_MODEL_A = 10_000
ACTIVE_WRONG_MODEL = 10_000
MODEL_A = "candidate-benchmark-model-a"
MODEL_B = "candidate-benchmark-wrong-model"
JOB_ID = UUID("30000000-0000-4000-8000-000000000001")
JOB_VERSION = 1
VECTOR_DIMENSIONS = 384
WARMUP_CALLS = 500
MEASURED_CALLS = 10_000
CONCURRENCY = 32
MAX_P95_MS = 500.0
MAX_P99_MS = 1_000.0
MIN_RPS = 75.0
MAX_SINGLE_CALL_MS = 2_000.0
EXPECTED_HEAD = "20260829_06"
EXPECTED_BASE_HEAD = "20260828_05"
INDEX_NAME = "cv_embeddings_active_vector_hnsw_idx"
EXPECTED_PG_IMAGE = (
    "mirror.gcr.io/pgvector/pgvector@sha256:"
    "ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b"
)
EXPECTED_PYTHON_IMAGE = (
    "public.ecr.aws/docker/library/python@sha256:"
    "be1575ed968de893bd54f4c56315ff7c4736ce522c1bca08fd521731aafc0d76"
)
ID_PATTERN = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
RUN_ID_PATTERN = re.compile(r"^[0-9]{14}-[0-9]+-[0-9a-f]{8}$")
DATABASE_NAME = "ai_candidate_benchmark"
DATABASE_SENTINEL_PREFIX = "recruitment-ai-candidate-benchmark:"


@dataclass(frozen=True, slots=True)
class ScopeCase:
    size: int
    pages: int
    limit: int
    sequences: tuple[int, ...]
    filters: CandidateRecommendationFilters
    expected: tuple[tuple[UUID, float], ...]


def fail(message: str) -> None:
    raise RuntimeError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def required_environment(name: str) -> str:
    value = os.environ.get(name, "")
    require(bool(value), f"{name} is required")
    return value


def cv_id(sequence: int) -> UUID:
    return UUID(f"10000000-0000-4000-8000-{sequence:012d}")


def candidate_id(sequence: int) -> UUID:
    return UUID(f"20000000-0000-4000-8000-{sequence:012d}")


def float32(value: float) -> float:
    return struct.unpack("!f", struct.pack("!f", value))[0]


def oracle_distance(sequence: int) -> float:
    second = float32(sequence / DATASET_SIZE)
    return 1.0 - (1.0 / math.sqrt(1.0 + second * second))


def candidate_filters(sequences: Sequence[int]) -> CandidateRecommendationFilters:
    return CandidateRecommendationFilters(
        tuple(
            CandidateEligibility(candidate_id(value), cv_id(value), 1, 1)
            for value in sequences
        )
    )


def scope_case(size: int, pages: int, sequences: Iterable[int]) -> ScopeCase:
    values = tuple(sequences)
    require(len(values) == size, f"scope {size} fixture length differs")
    require(size % pages == 0, f"scope {size} cannot fill {pages} exact pages")
    expected = tuple(
        sorted(
            ((candidate_id(value), oracle_distance(value)) for value in values),
            key=lambda item: (item[1], item[0].int),
        )
    )
    return ScopeCase(
        size=size,
        pages=pages,
        limit=size // pages,
        sequences=values,
        filters=candidate_filters(values),
        expected=expected,
    )


def repository(database_url: str) -> PsycopgRecommendationRepository:
    return PsycopgRecommendationRepository(
        database_url,
        connect_timeout_seconds=3,
        statement_timeout_ms=2_000,
    )


def validate_environment() -> tuple[str, str, dict[str, str]]:
    database_url = required_environment("DATABASE_URL")
    run_id = required_environment("BENCHMARK_RUN_ID")
    require(bool(RUN_ID_PATTERN.fullmatch(run_id)), "invalid benchmark run ID")
    parsed = urlparse(database_url)
    require(parsed.scheme in {"postgresql", "postgres"}, "invalid database scheme")
    require(parsed.username == "postgres", "benchmark database user must be postgres")
    require(
        parsed.password is None,
        "benchmark database URL must not contain a password",
    )
    require(parsed.port == 5432, "benchmark database port must be 5432")
    require(
        parsed.hostname == f"ai-candidate-benchmark-pg-{run_id}",
        "benchmark database must be the isolated Docker alias",
    )
    require(parsed.path == f"/{DATABASE_NAME}", "unexpected benchmark database name")
    require(
        not parsed.params and not parsed.query and not parsed.fragment,
        "invalid database URL",
    )
    pg_ref = required_environment("BENCHMARK_POSTGRES_IMAGE_REF")
    python_ref = required_environment("BENCHMARK_PYTHON_IMAGE_REF")
    require(pg_ref == EXPECTED_PG_IMAGE, "unexpected PostgreSQL image reference")
    require(python_ref == EXPECTED_PYTHON_IMAGE, "unexpected Python image reference")
    image_ids = {
        "postgresImageId": required_environment("BENCHMARK_POSTGRES_IMAGE_ID"),
        "pythonImageId": required_environment("BENCHMARK_PYTHON_IMAGE_ID"),
        "applicationImageId": required_environment("BENCHMARK_APPLICATION_IMAGE_ID"),
    }
    for name, value in image_ids.items():
        require(bool(ID_PATTERN.fullmatch(value)), f"invalid {name}")
    return (
        database_url,
        run_id,
        {
            "postgresRef": pg_ref,
            "pythonRef": python_ref,
            **image_ids,
        },
    )


def validate_migrations(
    database_url: str,
    run_id: str,
    *,
    expected_head: str,
) -> dict[str, object]:
    with psycopg.connect(database_url) as connection:
        head = connection.execute(
            "SELECT version_num FROM ai.alembic_version"
        ).fetchone()
        extension = connection.execute(
            "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
        ).fetchone()
        server = connection.execute("SHOW server_version").fetchone()
        database_identity = connection.execute(
            """
            SELECT current_database(), shobj_description(oid, 'pg_database')
            FROM pg_database
            WHERE datname = current_database()
            """
        ).fetchone()
    require(head == (expected_head,), f"Alembic head differs: {head!r}")
    require(extension is not None, "pgvector extension is missing")
    require(
        server is not None and server[0].startswith("16."),
        "PostgreSQL is not 16.x",
    )
    require(
        database_identity == (DATABASE_NAME, f"{DATABASE_SENTINEL_PREFIX}{run_id}"),
        "benchmark database sentinel differs",
    )
    return {
        "alembicHead": head[0],
        "pgvectorVersion": extension[0],
        "postgresVersion": server[0],
        "databaseName": database_identity[0],
        "databaseSentinelValidated": True,
    }


def seed_fixture(database_url: str) -> dict[str, object]:
    vector_expression = """
        (
            ARRAY[1.0::real, (fixture.sequence / %s::double precision)::real]
            || array_fill(0.0::real, ARRAY[382])
        )::vector
    """
    with psycopg.connect(database_url) as connection:
        index_before_seed = connection.execute(
            "SELECT to_regclass(%s)", (f"ai.{INDEX_NAME}",)
        ).fetchone()
    require(index_before_seed == (None,), "CV HNSW index exists before revision 06")
    insert_started = time.perf_counter()
    with psycopg.connect(database_url) as connection:
        connection.execute("SET LOCAL synchronous_commit = off")
        connection.execute(
            "ALTER TABLE ai.cv_embeddings "
            "DISABLE TRIGGER cv_embeddings_recommendation_generation"
        )
        connection.execute(
            "ALTER TABLE ai.cv_embeddings "
            "DISABLE TRIGGER cv_embeddings_recommendation_truncate"
        )
        connection.execute(
            f"""
            INSERT INTO ai.cv_embeddings (
                cv_id, user_id, vector, text_hash, model_name,
                source_version, is_active
            )
            SELECT
                ('10000000-0000-4000-8000-' ||
                    lpad(fixture.sequence::text, 12, '0'))::uuid,
                ('20000000-0000-4000-8000-' ||
                    lpad(fixture.sequence::text, 12, '0'))::uuid,
                {vector_expression},
                repeat('a', 64),
                CASE WHEN fixture.sequence <= 90000 THEN %s ELSE %s END,
                1,
                fixture.sequence <= 80000 OR fixture.sequence > 90000
            FROM generate_series(1, %s) AS fixture(sequence)
            """,
            (DATASET_SIZE, MODEL_A, MODEL_B, DATASET_SIZE),
        )
        connection.execute(
            "UPDATE ai.recommendation_generations "
            "SET generation = generation + 1 WHERE target_type = 'CVS'"
        )
        connection.execute(
            "ALTER TABLE ai.cv_embeddings "
            "ENABLE TRIGGER cv_embeddings_recommendation_generation"
        )
        connection.execute(
            "ALTER TABLE ai.cv_embeddings "
            "ENABLE TRIGGER cv_embeddings_recommendation_truncate"
        )
        connection.execute(
            """
            INSERT INTO ai.job_embeddings (
                job_id, vector, text_hash, model_name, is_active, source_version
            ) VALUES (
                %s,
                (ARRAY[1.0::real] || array_fill(0.0::real, ARRAY[383]))::vector,
                repeat('b', 64), %s, true, %s
            )
            """,
            (JOB_ID, MODEL_A, JOB_VERSION),
        )
    insert_ms = (time.perf_counter() - insert_started) * 1_000
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT
                count(*),
                count(*) FILTER (WHERE is_active AND model_name = %s),
                count(*) FILTER (WHERE NOT is_active AND model_name = %s),
                count(*) FILTER (WHERE is_active AND model_name = %s)
            FROM ai.cv_embeddings
            """,
            (MODEL_A, MODEL_A, MODEL_B),
        ).fetchone()
        triggers = connection.execute(
            """
            SELECT tgname, tgenabled
            FROM pg_trigger
            WHERE tgrelid = 'ai.cv_embeddings'::regclass
              AND tgname IN (
                  'cv_embeddings_recommendation_generation',
                  'cv_embeddings_recommendation_truncate'
              )
            ORDER BY tgname
            """
        ).fetchall()
        jobs = connection.execute("SELECT count(*) FROM ai.job_embeddings").fetchone()
    require(
        row == (DATASET_SIZE, ACTIVE_MODEL_A, INACTIVE_MODEL_A, ACTIVE_WRONG_MODEL),
        f"fixture counts differ: {row!r}",
    )
    require(
        triggers
        == [
            ("cv_embeddings_recommendation_generation", "O"),
            ("cv_embeddings_recommendation_truncate", "O"),
        ],
        "CV recommendation generation triggers are not both enabled",
    )
    require(jobs == (1,), "source Job count differs")
    return {
        "total": row[0],
        "activeModelA": row[1],
        "inactiveModelA": row[2],
        "activeWrongModel": row[3],
        "sourceJobs": jobs[0],
        "fixtureInsertMs": round(insert_ms, 3),
        "bulkSeedControls": {
            "seededAtAlembicHead": EXPECTED_BASE_HEAD,
            "hnswAbsentDuringBulkInsert": True,
            "generationTriggersSuspended": [
                "cv_embeddings_recommendation_generation",
                "cv_embeddings_recommendation_truncate",
            ],
            "generationBumpedOnce": True,
            "generationTriggersReenabledBeforeVerification": True,
        },
    }


def upgrade_populated_cv_index(database_url: str) -> dict[str, object]:
    service_root = Path.cwd().resolve()
    alembic_path = service_root / "alembic.ini"
    migration_path = (
        service_root / "migrations" / "versions" / "20260829_06_cv_ann_index.py"
    )
    require(service_root == Path("/app"), "unexpected benchmark service root")
    require(alembic_path.is_file(), "benchmark Alembic config is missing")
    require(migration_path.is_file(), "CV HNSW migration is missing")
    migration_source = migration_path.read_text(encoding="utf-8")
    require(
        "CREATE INDEX CONCURRENTLY" in migration_source,
        "CV HNSW migration is not concurrent",
    )

    previous_pgoptions = os.environ.get("PGOPTIONS")
    os.environ["PGOPTIONS"] = "-c maintenance_work_mem=512MB"
    started = time.perf_counter()
    try:
        command.upgrade(Config(str(alembic_path)), EXPECTED_HEAD)
    finally:
        if previous_pgoptions is None:
            os.environ.pop("PGOPTIONS", None)
        else:
            os.environ["PGOPTIONS"] = previous_pgoptions
    migration_ms = (time.perf_counter() - started) * 1_000

    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("ANALYZE ai.cv_embeddings")
        connection.execute("ANALYZE ai.job_embeddings")
        index_bytes = connection.execute(
            f"SELECT pg_relation_size('ai.{INDEX_NAME}'::regclass)"
        ).fetchone()
    require(index_bytes is not None and index_bytes[0] > 0, "HNSW index is empty")
    return {
        "fromRevision": EXPECTED_BASE_HEAD,
        "toRevision": EXPECTED_HEAD,
        "mode": "CREATE_INDEX_CONCURRENTLY",
        "populatedRows": DATASET_SIZE,
        "maintenanceWorkMem": "512MB",
        "migrationBuildMs": round(migration_ms, 3),
        "hnswBytes": index_bytes[0],
        "concurrentWriterMeasured": False,
    }


def validate_index(database_url: str) -> dict[str, object]:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT
                index_method.amname,
                index_state.indisvalid,
                index_state.indisready,
                index_state.indislive,
                pg_get_expr(index_state.indpred, index_state.indrelid),
                pg_get_indexdef(index_relation.oid),
                coalesce(array_to_string(index_relation.reloptions, ','), '')
            FROM pg_class AS index_relation
            JOIN pg_namespace AS namespace
              ON namespace.oid = index_relation.relnamespace
            JOIN pg_index AS index_state
              ON index_state.indexrelid = index_relation.oid
            JOIN pg_am AS index_method
              ON index_method.oid = index_relation.relam
            WHERE namespace.nspname = 'ai'
              AND index_relation.relname = %s
            """,
            (INDEX_NAME,),
        ).fetchone()
    require(row is not None, "CV HNSW index is missing")
    method, valid, ready, live, predicate, definition, options = row
    require(method == "hnsw", f"unexpected index method: {method}")
    require(valid and ready and live, "CV HNSW index is invalid or not ready")
    require(predicate == "is_active", f"unexpected partial predicate: {predicate}")
    require("vector_cosine_ops" in definition, "cosine operator class is missing")
    require(
        "m=16" in options and "ef_construction=64" in options,
        "HNSW options differ",
    )
    return {
        "name": INDEX_NAME,
        "method": method,
        "valid": valid,
        "ready": ready,
        "live": live,
        "predicate": predicate,
        "options": options,
    }


def assert_items(
    actual: Sequence[object],
    expected: Sequence[tuple[UUID, float]],
    label: str,
) -> None:
    require(len(actual) == len(expected), f"{label}: result length differs")
    for offset, (item, oracle) in enumerate(zip(actual, expected, strict=True)):
        expected_id, expected_distance = oracle
        require(item.item_id == expected_id, f"{label}: item {offset} differs")
        require(
            math.isclose(item.distance, expected_distance, abs_tol=2e-7),
            f"{label}: distance {offset} differs",
        )


def verify_scope_walks(
    database_url: str, cases: Sequence[ScopeCase]
) -> dict[str, object]:
    repo = repository(database_url)
    report: dict[str, object] = {}
    for case in cases:
        boundary: RecommendationBoundary | None = None
        fingerprint: str | None = None
        collected: list[object] = []
        page_sizes: list[int] = []
        for page_number in range(1, case.pages + 1):
            page = repo.recommend_candidates(
                JOB_ID,
                case.filters,
                job_version=JOB_VERSION,
                limit=case.limit,
                boundary=boundary,
                expected_source_fingerprint=fingerprint,
            )
            require(
                page.reason is None,
                f"scope {case.size} returned an empty reason",
            )
            require(page.source_fingerprint is not None, "source fingerprint missing")
            if fingerprint is None:
                fingerprint = page.source_fingerprint
            require(
                page.source_fingerprint == fingerprint,
                "fingerprint changed mid-walk",
            )
            page_sizes.append(len(page.items))
            collected.extend(page.items)
            if page_number < case.pages:
                require(
                    page.next_boundary is not None,
                    "cursor ended before requested page",
                )
                require(page.next_boundary.page == page_number, "cursor page differs")
                boundary = page.next_boundary
            else:
                require(page.next_boundary is None, "terminal page returned a cursor")
        assert_items(collected, case.expected, f"scope-{case.size}")
        require(
            len({item.item_id for item in collected}) == case.size,
            f"scope {case.size} leaked or duplicated an identity",
        )
        report[str(case.size)] = {
            "pages": case.pages,
            "limit": case.limit,
            "pageSizes": page_sizes,
            "items": len(collected),
            "oracleMismatches": 0,
            "leakedItems": 0,
        }
    return report


def verify_isolation(database_url: str) -> dict[str, object]:
    values = (1, 2, 80_001, 90_001)
    filters = CandidateRecommendationFilters(
        (
            CandidateEligibility(candidate_id(1), cv_id(1), 1, 1),
            CandidateEligibility(candidate_id(2), cv_id(3), 1, 1),
            CandidateEligibility(candidate_id(80_001), cv_id(80_001), 1, 1),
            CandidateEligibility(candidate_id(90_001), cv_id(90_001), 1, 1),
        )
    )
    require(tuple(sorted(values)) == values, "isolation scope is not deterministic")
    page = repository(database_url).recommend_candidates(
        JOB_ID,
        filters,
        job_version=JOB_VERSION,
        limit=10,
        boundary=None,
        expected_source_fingerprint=None,
    )
    require(page.reason is None, "isolation query unexpectedly returned a reason")
    require(
        [item.item_id for item in page.items] == [candidate_id(1)],
        "wrong-owner, inactive or wrong-model CV leaked",
    )
    return {
        "eligibleRows": 4,
        "returnedRows": 1,
        "wrongOwnerLeaks": 0,
        "inactiveLeaks": 0,
        "wrongModelLeaks": 0,
    }


def generation(connection: psycopg.Connection[object]) -> int:
    row = connection.execute(
        "SELECT generation FROM ai.recommendation_generations "
        "WHERE target_type = 'CVS'"
    ).fetchone()
    require(row is not None and isinstance(row[0], int), "CV generation missing")
    return row[0]


def verify_cursor_fingerprint(database_url: str, case: ScopeCase) -> dict[str, object]:
    repo = repository(database_url)
    first = repo.recommend_candidates(
        JOB_ID,
        case.filters,
        job_version=JOB_VERSION,
        limit=case.limit,
        boundary=None,
        expected_source_fingerprint=None,
    )
    require(first.next_boundary is not None, "cursor fixture did not paginate")
    with psycopg.connect(database_url) as connection:
        before_commit = generation(connection)
        connection.execute(
            "UPDATE ai.cv_embeddings SET updated_at = clock_timestamp() "
            "WHERE cv_id = %s",
            (cv_id(79_999),),
        )
    stale = False
    try:
        repo.recommend_candidates(
            JOB_ID,
            case.filters,
            job_version=JOB_VERSION,
            limit=case.limit,
            boundary=first.next_boundary,
            expected_source_fingerprint=first.source_fingerprint,
        )
    except StaleRecommendationCursor:
        stale = True
    require(stale, "committed unrelated target mutation did not stale the cursor")

    fresh = repo.recommend_candidates(
        JOB_ID,
        case.filters,
        job_version=JOB_VERSION,
        limit=case.limit,
        boundary=None,
        expected_source_fingerprint=None,
    )
    require(fresh.next_boundary is not None, "fresh cursor fixture did not paginate")
    with psycopg.connect(database_url) as connection:
        stable_generation = generation(connection)
        connection.execute(
            "UPDATE ai.cv_embeddings SET updated_at = clock_timestamp() "
            "WHERE cv_id = %s",
            (cv_id(999_999),),
        )
    with psycopg.connect(database_url) as connection:
        after_zero_rows = generation(connection)
        connection.execute(
            "UPDATE ai.cv_embeddings SET updated_at = clock_timestamp() "
            "WHERE cv_id = %s",
            (cv_id(79_998),),
        )
        connection.rollback()
    with psycopg.connect(database_url) as connection:
        after_rollback = generation(connection)
    require(
        after_zero_rows == stable_generation,
        "zero-row mutation bumped generation",
    )
    require(
        after_rollback == stable_generation,
        "rolled-back mutation bumped generation",
    )
    continuation = repo.recommend_candidates(
        JOB_ID,
        case.filters,
        job_version=JOB_VERSION,
        limit=case.limit,
        boundary=fresh.next_boundary,
        expected_source_fingerprint=fresh.source_fingerprint,
    )
    require(bool(continuation.items), "stable cursor could not continue")
    return {
        "generationBeforeCommittedMutation": before_commit,
        "committedUnrelatedMutationStale": stale,
        "zeroRowMutationStable": True,
        "rolledBackMutationStable": True,
    }


def walk_plan_nodes(node: dict[str, object]) -> Iterable[dict[str, object]]:
    yield node
    for child in node.get("Plans", []):
        if isinstance(child, dict):
            yield from walk_plan_nodes(child)


def explain_exact_plan(database_url: str, case: ScopeCase) -> dict[str, object]:
    ids = [candidate_id(value) for value in case.sequences]
    cvs = [cv_id(value) for value in case.sequences]
    with psycopg.connect(database_url) as connection:
        source = connection.execute(
            "SELECT vector::text FROM ai.job_embeddings WHERE job_id = %s",
            (JOB_ID,),
        ).fetchone()
        require(source is not None, "source vector missing")
        query = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + _candidate_rows_query("")
        raw = connection.execute(
            query,
            {
                "source_vector": source[0],
                "model_name": MODEL_A,
                "eligible_candidate_ids": ids,
                "eligible_cv_ids": cvs,
                "result_limit": case.limit + 1,
            },
        ).fetchone()
    require(raw is not None and isinstance(raw[0], list), "exact plan JSON missing")
    document = raw[0][0]
    root = document["Plan"]
    nodes = list(walk_plan_nodes(root))
    cv_nodes = [node for node in nodes if node.get("Relation Name") == "cv_embeddings"]
    indexes = sorted(
        {str(node["Index Name"]) for node in nodes if node.get("Index Name")}
    )
    require(cv_nodes, f"scope {case.size} exact plan did not access CV rows")
    require(
        not any(node.get("Node Type") == "Seq Scan" for node in cv_nodes),
        f"scope {case.size} exact plan used a CV sequential scan",
    )
    require(INDEX_NAME not in indexes, f"scope {case.size} exact plan used HNSW")
    require(
        "cv_embeddings_pkey" in indexes or "cv_embeddings_active_user_idx" in indexes,
        f"scope {case.size} exact plan did not use a PK/B-tree index",
    )
    return {
        "scope": case.size,
        "executionMs": document.get("Execution Time"),
        "indexes": indexes,
        "cvNodeTypes": sorted({str(node.get("Node Type")) for node in cv_nodes}),
        "usesPkOrBtree": True,
        "usesCvSeqScan": False,
        "usesHnsw": False,
    }


def global_ann_experiment(database_url: str, whitelist: ScopeCase) -> dict[str, object]:
    query = """
        WITH ann AS MATERIALIZED (
            SELECT user_id, cv_id,
                   (vector <=> %s::vector)::double precision AS distance
            FROM ai.cv_embeddings
            WHERE is_active AND model_name = %s
            ORDER BY vector <=> %s::vector
            LIMIT %s
        )
        SELECT user_id, cv_id, distance
        FROM ann
        ORDER BY distance, cv_id
    """
    with psycopg.connect(database_url) as connection:
        source = connection.execute(
            "SELECT vector::text FROM ai.job_embeddings WHERE job_id = %s",
            (JOB_ID,),
        ).fetchone()
        require(source is not None, "source vector missing for ANN experiment")
        connection.execute("SET LOCAL enable_seqscan = off")
        connection.execute("SET LOCAL enable_bitmapscan = off")
        connection.execute("SET LOCAL enable_sort = off")
        connection.execute("SET LOCAL hnsw.ef_search = 1000")
        explained = connection.execute(
            "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query,
            (source[0], MODEL_A, source[0], 100),
        ).fetchone()
        ann_rows = connection.execute(
            query, (source[0], MODEL_A, source[0], 100)
        ).fetchall()
        ann_pool = connection.execute(
            query, (source[0], MODEL_A, source[0], 500)
        ).fetchall()
    require(
        explained is not None and isinstance(explained[0], list),
        "ANN plan missing",
    )
    document = explained[0][0]
    nodes = list(walk_plan_nodes(document["Plan"]))
    indexes = sorted(
        {str(node["Index Name"]) for node in nodes if node.get("Index Name")}
    )
    require(INDEX_NAME in indexes, "global ANN experiment did not use CV HNSW")
    expected_global = {candidate_id(value) for value in range(1, 101)}
    actual_global = {row[0] for row in ann_rows}
    recall = len(expected_global & actual_global) / len(expected_global)
    require(len(ann_rows) == 100, "global ANN top-100 result length differs")
    require(len(ann_pool) == 500, "global ANN pool result length differs")
    require(recall >= 0.99, f"global ANN recall@100 is too low: {recall:.3f}")
    whitelist_ids = {item[0] for item in whitelist.expected}
    exact_whitelist_top = {item[0] for item in whitelist.expected[:50]}
    global_then_filter = {row[0] for row in ann_pool if row[0] in whitelist_ids}
    completeness = exact_whitelist_top.issubset(global_then_filter)
    require(
        not completeness,
        "global ANN unexpectedly proved dynamic-whitelist completeness",
    )
    return {
        "planExecutionMs": document.get("Execution Time"),
        "indexes": indexes,
        "topK": 100,
        "recallAt100": round(recall, 6),
        "globalPoolSize": len(ann_pool),
        "whitelistSize": whitelist.size,
        "eligibleFoundAfterGlobalPool": len(global_then_filter),
        "exactWhitelistTopK": 50,
        "globalThenDynamicWhitelistComplete": False,
        "missingExactWhitelistTopK": len(exact_whitelist_top - global_then_filter),
        "productionAnnEnabled": False,
        "plannerSettings": {
            "enableSeqscan": False,
            "enableBitmapscan": False,
            "enableSort": False,
            "hnswEfSearch": 1000,
            "advisoryExperimentOnly": True,
        },
    }


def percentile(values: Sequence[float], quantile: float) -> float:
    require(bool(values), "cannot calculate a percentile of an empty sample")
    ordered = sorted(values)
    rank = max(0, math.ceil(quantile * len(ordered)) - 1)
    return ordered[rank]


def benchmark_call(
    repo: PsycopgRecommendationRepository, case: ScopeCase
) -> tuple[int, float, bool, str | None]:
    started = time.perf_counter()
    try:
        page = repo.recommend_candidates(
            JOB_ID,
            case.filters,
            job_version=JOB_VERSION,
            limit=case.limit,
            boundary=None,
            expected_source_fingerprint=None,
        )
        expected_ids = [item[0] for item in case.expected[: case.limit]]
        mismatch = (
            page.reason is not None
            or page.source_fingerprint is None
            or [item.item_id for item in page.items] != expected_ids
            or any(item.item_id not in expected_ids for item in page.items)
        )
        return case.size, (time.perf_counter() - started) * 1_000, mismatch, None
    except Exception as error:  # noqa: BLE001 - the gate must count every failure.
        return (
            case.size,
            (time.perf_counter() - started) * 1_000,
            False,
            type(error).__name__,
        )


def run_load_gate(database_url: str, cases: Sequence[ScopeCase]) -> dict[str, object]:
    repo = repository(database_url)
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        warmup_results = list(
            executor.map(
                lambda index: benchmark_call(repo, cases[index % len(cases)]),
                range(WARMUP_CALLS),
            )
        )
        require(
            not any(error or mismatch for _, _, mismatch, error in warmup_results),
            "warm-up call failed or differed from its source scope",
        )
        started = time.perf_counter()
        results = list(
            executor.map(
                lambda index: benchmark_call(repo, cases[index % len(cases)]),
                range(MEASURED_CALLS),
            )
        )
        duration = time.perf_counter() - started
    errors = sum(error is not None for _, _, _, error in results)
    mismatches = sum(mismatch for _, _, mismatch, _ in results)
    latencies = [latency for _, latency, _, _ in results]
    requests_per_second = MEASURED_CALLS / duration
    p95 = percentile(latencies, 0.95)
    p99 = percentile(latencies, 0.99)
    grouped: dict[int, list[float]] = defaultdict(list)
    grouped_errors: dict[int, int] = defaultdict(int)
    grouped_mismatches: dict[int, int] = defaultdict(int)
    for size, latency, mismatch, error in results:
        grouped[size].append(latency)
        grouped_errors[size] += int(error is not None)
        grouped_mismatches[size] += int(mismatch)
    per_scope = {
        str(size): {
            "requests": len(values),
            "errors": grouped_errors[size],
            "sourceMismatches": grouped_mismatches[size],
            "p50Ms": round(percentile(values, 0.50), 3),
            "p95Ms": round(percentile(values, 0.95), 3),
            "p99Ms": round(percentile(values, 0.99), 3),
            "maxMs": round(max(values), 3),
        }
        for size, values in sorted(grouped.items())
    }
    require(errors == 0, f"measured recommendation errors: {errors}")
    require(mismatches == 0, f"measured source mismatches: {mismatches}")
    require(p95 <= MAX_P95_MS, f"p95 {p95:.3f}ms exceeds {MAX_P95_MS:.0f}ms")
    require(p99 <= MAX_P99_MS, f"p99 {p99:.3f}ms exceeds {MAX_P99_MS:.0f}ms")
    require(
        max(latencies) <= MAX_SINGLE_CALL_MS,
        f"max {max(latencies):.3f}ms exceeds production timeout",
    )
    require(
        requests_per_second >= MIN_RPS,
        f"throughput {requests_per_second:.3f} RPS is below {MIN_RPS:.0f}",
    )
    return {
        "warmupCalls": WARMUP_CALLS,
        "measuredCalls": MEASURED_CALLS,
        "concurrency": CONCURRENCY,
        "durationMs": round(duration * 1_000, 3),
        "requestsPerSecond": round(requests_per_second, 3),
        "errors": errors,
        "sourceMismatches": mismatches,
        "p50Ms": round(percentile(latencies, 0.50), 3),
        "p95Ms": round(p95, 3),
        "p99Ms": round(p99, 3),
        "maxMs": round(max(latencies), 3),
        "thresholds": {
            "maxP95Ms": int(MAX_P95_MS),
            "maxP99Ms": int(MAX_P99_MS),
            "minRequestsPerSecond": int(MIN_RPS),
            "maxSingleCallMs": int(MAX_SINGLE_CALL_MS),
            "repositoryStatementTimeoutMs": 2_000,
        },
        "perScope": per_scope,
    }


def main() -> None:
    database_url, run_id, images = validate_environment()
    migration_before = validate_migrations(
        database_url,
        run_id,
        expected_head=EXPECTED_BASE_HEAD,
    )
    fixture = seed_fixture(database_url)
    populated_upgrade = upgrade_populated_cv_index(database_url)
    migration_after = validate_migrations(
        database_url,
        run_id,
        expected_head=EXPECTED_HEAD,
    )
    index = validate_index(database_url)
    cases = (
        scope_case(1, 1, (101,)),
        scope_case(100, 2, range(1_001, 1_101)),
        scope_case(500, 10, range(79_001, 79_501)),
    )
    correctness = verify_scope_walks(database_url, cases)
    isolation = verify_isolation(database_url)
    cursor = verify_cursor_fingerprint(database_url, cases[-1])
    exact_plans = [explain_exact_plan(database_url, case) for case in cases]
    ann = global_ann_experiment(database_url, cases[-1])
    load = run_load_gate(database_url, cases)
    report = {
        "gate": "candidate-recommendation-benchmark-v1",
        "status": "PASS",
        "dataset": fixture,
        "migrations": {
            "beforePopulatedUpgrade": migration_before,
            "afterPopulatedUpgrade": migration_after,
            "populatedUpgrade": populated_upgrade,
        },
        "index": {"migrationCreatedOnPopulatedFixture": index},
        "correctness": {
            "scopes": correctness,
            "isolation": isolation,
            "oracle": "python-float32-cosine-bruteforce",
        },
        "cursorGeneration": cursor,
        "plans": {"productionExact": exact_plans, "globalAnnExperiment": ann},
        "decision": {
            "productionStrategy": "EXACT_DYNAMIC_WHITELIST",
            "annEnabledForCandidateRecommendation": False,
            "reason": "global ANN followed by a dynamic whitelist is incomplete",
        },
        "load": load,
        "images": images,
    }
    print(json.dumps(report, sort_keys=True, separators=(",", ":")), flush=True)
    print(
        "[candidate-recommendation-benchmark] PASS: "
        "100k fixture, exact scopes, HNSW counterexample and load thresholds",
        flush=True,
    )


if __name__ == "__main__":
    main()
