#!/usr/bin/env python3
"""Guarded full-target correctness and HTTP load gate for job recommendations."""

from __future__ import annotations

import concurrent.futures
import json
import math
import os
import re
import socket
import struct
import threading
import time
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID

import psycopg

from app.recommendation import JobRecommendationFilters
from app.recommendation_repository import PsycopgRecommendationRepository

DATASET_SIZE = 100_000
ACTIVE_MODEL_A = 80_000
INACTIVE_MODEL_A = 10_000
ACTIVE_WRONG_MODEL = 10_000
VECTOR_DIMENSIONS = 384
MODEL_A = "job-benchmark-model-a"
MODEL_B = "job-benchmark-wrong-model"
SOURCE_CV_ID = UUID("10000000-0000-4000-8000-000000000001")
SOURCE_USER_ID = UUID("20000000-0000-4000-8000-000000000001")
EXPECTED_HEAD = "20260829_06"
INDEX_NAME = "job_embeddings_active_vector_hnsw_idx"
DATABASE_NAME = "ai_job_benchmark"
DATABASE_SENTINEL_PREFIX = "recruitment-ai-job-benchmark:"
GATE_NAME = "job-recommendation-full-target-benchmark-v1"
STATEMENT_TIMEOUT_MS = 2_000
MAX_RESPONSE_BYTES = 64 * 1024
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
INTEGER_PATTERN = re.compile(r"^[0-9]+$")
DECIMAL_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+)?$")
LOCATIONS = ("Hà Nội", "Đà Nẵng", "Hồ Chí Minh", "Cần Thơ")
JOB_TYPES = ("FULL_TIME", "PART_TIME", "REMOTE", "INTERNSHIP")
INACTIVE_ONLY_LOCATION = "Inactive Only"
WRONG_MODEL_ONLY_LOCATION = "Wrong Model Only"
SUCCESS_KEYS = frozenset({"data", "meta"})
DATA_KEYS = frozenset({"cv_id", "items", "next_cursor", "reason"})
ITEM_KEYS = frozenset({"job_id", "score"})
ERROR_KEYS = frozenset({"code", "message", "details"})
BANNED_RESPONSE_KEYS = frozenset(
    {
        "distance",
        "model_name",
        "source_event_id",
        "source_fingerprint",
        "source_occurred_at",
        "source_version",
        "text_hash",
        "updated_at",
        "user_id",
        "vector",
    }
)
BANNED_RESPONSE_HEADERS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "x-internal-api-key",
        "x-internal-service",
    }
)


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(
        self,
        request: Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> None:
        return None


HTTP_OPENER = build_opener(ProxyHandler({}), NoRedirectHandler())


@dataclass(frozen=True, slots=True)
class BenchmarkConfig:
    database_url: str
    api_url: str
    run_id: str
    internal_api_key: str
    warmup_calls: int
    measured_calls: int
    concurrency: int
    http_timeout_seconds: int
    max_p95_ms: int
    max_p99_ms: int
    max_call_ms: int
    min_rps: float
    images: dict[str, str]


@dataclass(frozen=True, slots=True)
class OracleJob:
    sequence: int
    job_id: UUID
    distance: float
    score: float
    location: str
    salary_max: int | None
    job_type: str


@dataclass(frozen=True, slots=True)
class QueryCase:
    name: str
    pages: int
    limit: int
    location: str | None = None
    salary_min: Decimal | None = None
    job_type: str | None = None

    def payload(self, cursor: str | None = None) -> dict[str, object]:
        value: dict[str, object] = {
            "cv_id": str(SOURCE_CV_ID),
            "limit": self.limit,
        }
        if cursor is not None:
            value["cursor"] = cursor
        if self.location is not None:
            value["location"] = self.location
        if self.salary_min is not None:
            value["salary_min"] = format(self.salary_min, "f")
        if self.job_type is not None:
            value["job_type"] = self.job_type
        return value


@dataclass(frozen=True, slots=True)
class HttpResult:
    status: int
    body: object
    headers: Mapping[str, str]
    latency_ms: float


class HttpTransportFailure(RuntimeError):
    def __init__(self, kind: str, latency_ms: float) -> None:
        super().__init__(kind)
        self.kind = kind
        self.latency_ms = latency_ms


def fail(message: str) -> None:
    raise RuntimeError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def required_environment(name: str) -> str:
    value = os.environ.get(name, "")
    require(bool(value), f"{name} is required")
    return value


def bounded_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    require(bool(INTEGER_PATTERN.fullmatch(raw)), f"{name} must be an integer")
    value = int(raw)
    require(minimum <= value <= maximum, f"{name} must be {minimum}..{maximum}")
    return value


def bounded_decimal(
    name: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    raw = os.environ.get(name, str(default))
    require(bool(DECIMAL_PATTERN.fullmatch(raw)), f"{name} must be numeric")
    value = float(raw)
    require(
        math.isfinite(value) and minimum <= value <= maximum,
        f"{name} must be {minimum}..{maximum}",
    )
    return value


def validate_internal_key(value: str) -> None:
    require(32 <= len(value) <= 512, "BENCHMARK_INTERNAL_API_KEY length is unsafe")
    require(
        all(0x21 <= ord(character) <= 0x7E for character in value),
        "BENCHMARK_INTERNAL_API_KEY must be printable ASCII without spaces",
    )
    require("replace-with" not in value.lower(), "placeholder benchmark key refused")


def validate_environment() -> BenchmarkConfig:
    require(Path.cwd().resolve() == Path("/app"), "runner must execute from /app")
    for name in (
        "PGHOST",
        "PGHOSTADDR",
        "PGPORT",
        "PGDATABASE",
        "PGUSER",
        "PGPASSWORD",
        "PGPASSFILE",
        "PGSERVICE",
        "PGSERVICEFILE",
    ):
        require(name not in os.environ, f"external database override {name} refused")

    run_id = required_environment("BENCHMARK_RUN_ID")
    require(bool(RUN_ID_PATTERN.fullmatch(run_id)), "invalid benchmark run ID")
    database_url = required_environment("DATABASE_URL")
    database = urlparse(database_url)
    require(database.scheme in {"postgres", "postgresql"}, "invalid DB scheme")
    require(database.username == "postgres", "benchmark DB user must be postgres")
    require(database.password is None, "benchmark DB URL must not contain a password")
    require(database.port == 5432, "benchmark DB port must be 5432")
    require(
        database.hostname == f"ai-job-benchmark-pg-{run_id}",
        "benchmark DB must use the guarded internal alias",
    )
    require(database.path == f"/{DATABASE_NAME}", "unexpected benchmark DB name")
    require(
        not database.params and not database.query and not database.fragment,
        "benchmark DB URL components are invalid",
    )

    api_url = required_environment("BENCHMARK_API_URL")
    api = urlparse(api_url)
    require(api.scheme == "http", "benchmark API must use internal HTTP")
    require(api.username is None and api.password is None, "API userinfo is refused")
    require(api.port == 8000, "benchmark API port must be 8000")
    require(
        api.hostname == f"ai-job-benchmark-api-{run_id}",
        "benchmark API must use the guarded internal alias",
    )
    require(api.path == "/recommend/jobs", "benchmark API path must be exact")
    require(
        not api.params and not api.query and not api.fragment,
        "benchmark API URL components are invalid",
    )

    pg_ref = required_environment("BENCHMARK_POSTGRES_IMAGE_REF")
    python_ref = required_environment("BENCHMARK_PYTHON_IMAGE_REF")
    require(pg_ref == EXPECTED_PG_IMAGE, "unexpected PostgreSQL image reference")
    require(python_ref == EXPECTED_PYTHON_IMAGE, "unexpected Python image reference")
    images = {
        "postgresRef": pg_ref,
        "pythonRef": python_ref,
        "postgresImageId": required_environment("BENCHMARK_POSTGRES_IMAGE_ID"),
        "pythonImageId": required_environment("BENCHMARK_PYTHON_IMAGE_ID"),
        "applicationImageId": required_environment("BENCHMARK_APPLICATION_IMAGE_ID"),
    }
    for name, value in images.items():
        if name.endswith("ImageId"):
            require(bool(ID_PATTERN.fullmatch(value)), f"invalid {name}")

    internal_key = required_environment("BENCHMARK_INTERNAL_API_KEY")
    validate_internal_key(internal_key)
    warmup = bounded_integer("BENCHMARK_WARMUP_CALLS", 100, 10, 500)
    measured = bounded_integer("BENCHMARK_MEASURED_CALLS", 1_000, 100, 5_000)
    concurrency = bounded_integer("BENCHMARK_CONCURRENCY", 8, 1, 16)
    http_timeout = bounded_integer("BENCHMARK_HTTP_TIMEOUT_SECONDS", 12, 5, 30)
    max_p95 = bounded_integer("BENCHMARK_MAX_P95_MS", 5_000, 500, 15_000)
    max_p99 = bounded_integer("BENCHMARK_MAX_P99_MS", 7_500, 500, 20_000)
    max_call = bounded_integer("BENCHMARK_MAX_CALL_MS", 10_000, 1_000, 25_000)
    min_rps = bounded_decimal("BENCHMARK_MIN_RPS", 1.0, 0.1, 1_000.0)
    require(max_p95 <= max_p99 <= max_call, "latency thresholds are not ordered")
    require(
        max_call <= http_timeout * 1_000,
        "max-call threshold must not exceed the HTTP timeout",
    )
    return BenchmarkConfig(
        database_url=database_url,
        api_url=api_url,
        run_id=run_id,
        internal_api_key=internal_key,
        warmup_calls=warmup,
        measured_calls=measured,
        concurrency=concurrency,
        http_timeout_seconds=http_timeout,
        max_p95_ms=max_p95,
        max_p99_ms=max_p99,
        max_call_ms=max_call,
        min_rps=min_rps,
        images=images,
    )


def validate_database(config: BenchmarkConfig) -> dict[str, object]:
    with psycopg.connect(config.database_url) as connection:
        revision = connection.execute(
            "SELECT version_num FROM ai.alembic_version"
        ).fetchone()
        extension = connection.execute(
            "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
        ).fetchone()
        server = connection.execute("SHOW server_version").fetchone()
        identity = connection.execute(
            """
            SELECT current_database(), shobj_description(oid, 'pg_database')
            FROM pg_database
            WHERE datname = current_database()
            """
        ).fetchone()
        source_counts = connection.execute(
            "SELECT (SELECT count(*) FROM ai.cv_embeddings), "
            "       (SELECT count(*) FROM ai.job_embeddings)"
        ).fetchone()
    require(revision == (EXPECTED_HEAD,), f"Alembic head differs: {revision!r}")
    require(extension is not None, "pgvector extension is missing")
    require(
        server is not None and server[0].startswith("16."),
        "PostgreSQL is not 16.x",
    )
    require(
        identity == (DATABASE_NAME, f"{DATABASE_SENTINEL_PREFIX}{config.run_id}"),
        "database name/version/sentinel guard mismatch",
    )
    require(source_counts == (0, 0), "benchmark database is not empty")
    return {
        "alembicHead": revision[0],
        "pgvectorVersion": extension[0],
        "postgresVersion": server[0],
        "databaseName": identity[0],
        "databaseSentinelValidated": True,
    }


def job_id(sequence: int) -> UUID:
    return UUID(f"40000000-0000-4000-8000-{sequence:012d}")


def float32(value: float) -> float:
    return struct.unpack("!f", struct.pack("!f", value))[0]


def vector_rank(sequence: int) -> int:
    return 199 if sequence == 200 else sequence


def oracle_distance(sequence: int) -> float:
    second = float32(vector_rank(sequence) / DATASET_SIZE)
    return 1.0 - (1.0 / math.sqrt(1.0 + second * second))


def normal_location(sequence: int) -> str:
    return LOCATIONS[sequence % len(LOCATIONS)]


def job_type_for(sequence: int) -> str:
    return JOB_TYPES[sequence % len(JOB_TYPES)]


def salary_max_for(sequence: int) -> int | None:
    if sequence % 10 == 0:
        return None
    return 20_000_000 + (sequence % 100) * 100_000


def build_oracle() -> tuple[OracleJob, ...]:
    rows = [
        OracleJob(
            sequence=sequence,
            job_id=job_id(sequence),
            distance=oracle_distance(sequence),
            score=1.0 - (oracle_distance(sequence) / 2.0),
            location=normal_location(sequence),
            salary_max=salary_max_for(sequence),
            job_type=job_type_for(sequence),
        )
        for sequence in range(1, ACTIVE_MODEL_A + 1)
    ]
    rows.sort(key=lambda row: (row.distance, row.job_id.int))
    require(len(rows) == ACTIVE_MODEL_A, "oracle row count differs")
    tied = [row for row in rows if row.sequence in {199, 200}]
    require(
        [row.sequence for row in tied] == [199, 200]
        and tied[0].distance == tied[1].distance,
        "UUID tie fixture is not deterministic",
    )
    return tuple(rows)


def expected_for(case: QueryCase, oracle: Sequence[OracleJob]) -> tuple[OracleJob, ...]:
    normalized_location = (
        " ".join(unicodedata.normalize("NFKC", case.location).split()).lower()
        if case.location is not None
        else None
    )
    expected = tuple(
        row
        for row in oracle
        if (normalized_location is None or row.location.lower() == normalized_location)
        and (
            case.salary_min is None
            or row.salary_max is None
            or Decimal(row.salary_max) >= case.salary_min
        )
        and (case.job_type is None or row.job_type == case.job_type)
    )
    require(
        len(expected) >= case.pages * case.limit,
        f"oracle case {case.name} cannot fill requested pages",
    )
    return expected


def drop_job_hnsw_before_seed(database_url: str) -> None:
    with psycopg.connect(database_url, autocommit=True) as connection:
        row = connection.execute(
            """
            SELECT index_method.amname, index_state.indisvalid, index_state.indisready,
                   pg_get_expr(index_state.indpred, index_state.indrelid),
                   pg_get_indexdef(index_relation.oid)
            FROM pg_class AS index_relation
            JOIN pg_namespace AS namespace ON namespace.oid=index_relation.relnamespace
            JOIN pg_index AS index_state ON index_state.indexrelid=index_relation.oid
            JOIN pg_am AS index_method ON index_method.oid=index_relation.relam
            WHERE namespace.nspname='ai' AND index_relation.relname=%s
            """,
            (INDEX_NAME,),
        ).fetchone()
        require(row is not None, "production Job HNSW index is missing before seed")
        require(row[0] == "hnsw" and row[1] and row[2], "Job HNSW index is invalid")
        require(row[3] == "is_active", "Job HNSW predicate differs")
        require("vector_cosine_ops" in row[4], "Job HNSW cosine opclass missing")
        connection.execute(f"DROP INDEX ai.{INDEX_NAME}")


def seed_fixture(config: BenchmarkConfig) -> dict[str, object]:
    drop_job_hnsw_before_seed(config.database_url)
    vector_expression = """
        (
            ARRAY[
                1.0::real,
                ((CASE WHEN fixture.sequence=200 THEN 199 ELSE fixture.sequence END)
                    / %s::double precision)::real
            ] || array_fill(0.0::real, ARRAY[382])
        )::vector
    """
    started = time.perf_counter()
    with psycopg.connect(config.database_url) as connection:
        connection.execute("SET LOCAL synchronous_commit=off")
        connection.execute(
            "ALTER TABLE ai.job_embeddings DISABLE TRIGGER "
            "job_embeddings_recommendation_generation"
        )
        connection.execute(
            "ALTER TABLE ai.job_embeddings DISABLE TRIGGER "
            "job_embeddings_recommendation_truncate"
        )
        connection.execute(
            f"""
            INSERT INTO ai.job_embeddings (
                job_id, vector, text_hash, model_name, location,
                salary_min, salary_max, job_type, is_active, source_version
            )
            SELECT
                ('40000000-0000-4000-8000-' ||
                    lpad(fixture.sequence::text, 12, '0'))::uuid,
                {vector_expression},
                repeat('b', 64),
                CASE WHEN fixture.sequence <= 90000 THEN %s ELSE %s END,
                CASE
                    WHEN fixture.sequence <= 80000 THEN
                        CASE fixture.sequence %% 4
                            WHEN 0 THEN 'Hà Nội'
                            WHEN 1 THEN 'Đà Nẵng'
                            WHEN 2 THEN 'Hồ Chí Minh'
                            ELSE 'Cần Thơ'
                        END
                    WHEN fixture.sequence <= 90000 THEN %s
                    ELSE %s
                END,
                CASE WHEN fixture.sequence %% 10=0 THEN NULL
                     ELSE 10000000 + (fixture.sequence %% 100) * 100000 END,
                CASE WHEN fixture.sequence %% 10=0 THEN NULL
                     ELSE 20000000 + (fixture.sequence %% 100) * 100000 END,
                CASE fixture.sequence %% 4
                    WHEN 0 THEN 'FULL_TIME'
                    WHEN 1 THEN 'PART_TIME'
                    WHEN 2 THEN 'REMOTE'
                    ELSE 'INTERNSHIP'
                END,
                fixture.sequence <= 80000 OR fixture.sequence > 90000,
                1
            FROM generate_series(1, %s) AS fixture(sequence)
            """,
            (
                DATASET_SIZE,
                MODEL_A,
                MODEL_B,
                INACTIVE_ONLY_LOCATION,
                WRONG_MODEL_ONLY_LOCATION,
                DATASET_SIZE,
            ),
        )
        connection.execute(
            "UPDATE ai.recommendation_generations SET generation=generation+1 "
            "WHERE target_type='JOBS'"
        )
        connection.execute(
            "ALTER TABLE ai.job_embeddings ENABLE TRIGGER "
            "job_embeddings_recommendation_generation"
        )
        connection.execute(
            "ALTER TABLE ai.job_embeddings ENABLE TRIGGER "
            "job_embeddings_recommendation_truncate"
        )
        connection.execute(
            """
            INSERT INTO ai.cv_embeddings (
                cv_id, user_id, vector, text_hash, model_name,
                source_version, is_active
            ) VALUES (
                %s, %s,
                (ARRAY[1.0::real] || array_fill(0.0::real, ARRAY[383]))::vector,
                repeat('a', 64), %s, 1, true
            )
            """,
            (SOURCE_CV_ID, SOURCE_USER_ID, MODEL_A),
        )
        connection.execute(
            "INSERT INTO ai.cv_aggregate_owners (cv_id,user_id) VALUES (%s,%s)",
            (SOURCE_CV_ID, SOURCE_USER_ID),
        )
    insert_ms = (time.perf_counter() - started) * 1_000

    index_started = time.perf_counter()
    with psycopg.connect(config.database_url, autocommit=True) as connection:
        connection.execute("SET maintenance_work_mem='512MB'")
        connection.execute("SET statement_timeout=0")
        connection.execute(
            f"CREATE INDEX {INDEX_NAME} ON ai.job_embeddings "
            "USING hnsw (vector vector_cosine_ops) WHERE is_active"
        )
        connection.execute("ANALYZE ai.job_embeddings")
        connection.execute("ANALYZE ai.cv_embeddings")
    index_ms = (time.perf_counter() - index_started) * 1_000

    with psycopg.connect(config.database_url) as connection:
        counts = connection.execute(
            """
            SELECT count(*),
                   count(*) FILTER (WHERE is_active AND model_name=%s),
                   count(*) FILTER (WHERE NOT is_active AND model_name=%s),
                   count(*) FILTER (WHERE is_active AND model_name=%s)
            FROM ai.job_embeddings
            """,
            (MODEL_A, MODEL_A, MODEL_B),
        ).fetchone()
        source = connection.execute(
            "SELECT count(*) FROM ai.cv_embeddings WHERE cv_id=%s "
            "AND user_id=%s AND is_active AND model_name=%s",
            (SOURCE_CV_ID, SOURCE_USER_ID, MODEL_A),
        ).fetchone()
        triggers = connection.execute(
            """
            SELECT tgname,tgenabled FROM pg_trigger
            WHERE tgrelid='ai.job_embeddings'::regclass
              AND tgname IN (
                'job_embeddings_recommendation_generation',
                'job_embeddings_recommendation_truncate'
              ) ORDER BY tgname
            """
        ).fetchall()
        index_bytes = connection.execute(
            f"SELECT pg_relation_size('ai.{INDEX_NAME}'::regclass)"
        ).fetchone()
    require(
        counts == (DATASET_SIZE, ACTIVE_MODEL_A, INACTIVE_MODEL_A, ACTIVE_WRONG_MODEL),
        f"Job fixture counts differ: {counts!r}",
    )
    require(source == (1,), "source CV fixture differs")
    require(
        triggers
        == [
            ("job_embeddings_recommendation_generation", "O"),
            ("job_embeddings_recommendation_truncate", "O"),
        ],
        "Job recommendation generation triggers are not enabled",
    )
    require(index_bytes is not None and index_bytes[0] > 0, "Job HNSW is empty")
    return {
        "total": counts[0],
        "activeCorrectModel": counts[1],
        "inactiveCorrectModel": counts[2],
        "activeWrongModel": counts[3],
        "sourceCvRows": source[0],
        "fixtureInsertMs": round(insert_ms, 3),
        "hnswBuildMs": round(index_ms, 3),
        "hnswBytes": index_bytes[0],
        "generationTriggersSuspendedDuringBulkSeed": True,
        "generationBumpedOnce": True,
        "generationTriggersReenabled": True,
    }


def exact_headers(config: BenchmarkConfig) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Internal-Api-Key": config.internal_api_key,
        "X-Internal-Service": "job-search-service",
    }


def decode_json(raw: bytes, content_type: str | None) -> object:
    require(len(raw) <= MAX_RESPONSE_BYTES, "HTTP response exceeded 64 KiB")
    require(
        content_type is not None
        and content_type.split(";", 1)[0].strip().lower() == "application/json",
        "HTTP response content type is not application/json",
    )
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("HTTP response is not strict UTF-8 JSON") from error


def post_json(
    config: BenchmarkConfig,
    payload: Mapping[str, object],
    *,
    headers: Mapping[str, str] | None = None,
) -> HttpResult:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    request_headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    request_headers.update(exact_headers(config) if headers is None else dict(headers))
    request = Request(
        config.api_url,
        data=encoded,
        headers=request_headers,
        method="POST",
    )
    started = time.perf_counter()
    try:
        try:
            response = HTTP_OPENER.open(
                request,
                timeout=config.http_timeout_seconds,
            )
        except HTTPError as error:
            response = error
        with response:
            status = int(response.status)
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            result_headers = {
                key.lower(): value for key, value in response.headers.items()
            }
        latency_ms = (time.perf_counter() - started) * 1_000
        require(not 300 <= status < 400, "HTTP redirect is refused")
        body = decode_json(raw, result_headers.get("content-type"))
        return HttpResult(status, body, result_headers, latency_ms)
    except TimeoutError as error:
        latency_ms = (time.perf_counter() - started) * 1_000
        raise HttpTransportFailure("TIMEOUT", latency_ms) from error
    except URLError as error:
        latency_ms = (time.perf_counter() - started) * 1_000
        kind = "TIMEOUT" if isinstance(error.reason, socket.timeout) else "URL_ERROR"
        raise HttpTransportFailure(kind, latency_ms) from error


def object_keys(
    value: object,
    expected: frozenset[str],
    label: str,
) -> dict[str, object]:
    require(isinstance(value, dict), f"{label} must be an object")
    typed = value
    require(set(typed) == expected, f"{label} keys differ: {sorted(typed)}")
    return typed


def walk_response_keys(value: object) -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key)
            yield from walk_response_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_response_keys(child)


def assert_redacted(
    config: BenchmarkConfig,
    body: object,
    headers: Mapping[str, str],
    label: str,
) -> None:
    keys = {key.lower() for key in walk_response_keys(body)}
    require(not keys.intersection(BANNED_RESPONSE_KEYS), f"{label} leaked private keys")
    header_keys = {key.lower() for key in headers}
    require(
        not header_keys.intersection(BANNED_RESPONSE_HEADERS),
        f"{label} leaked protected response headers",
    )
    rendered = json.dumps(
        {"body": body, "headers": dict(headers)},
        sort_keys=True,
        ensure_ascii=False,
    )
    for secret in (
        config.internal_api_key,
        config.database_url,
        MODEL_A,
        MODEL_B,
        str(SOURCE_USER_ID),
    ):
        require(secret not in rendered, f"{label} leaked protected data")


def validate_success(
    config: BenchmarkConfig,
    response: HttpResult,
    expected: Sequence[OracleJob],
    *,
    cursor_expected: bool,
    label: str,
) -> str | None:
    require(
        response.status == 200,
        f"{label}: expected HTTP 200, got {response.status}",
    )
    root = object_keys(response.body, SUCCESS_KEYS, label)
    require(root["meta"] is None, f"{label}: meta must be null")
    data = object_keys(root["data"], DATA_KEYS, f"{label}.data")
    require(data["cv_id"] == str(SOURCE_CV_ID), f"{label}: CV echo differs")
    require(data["reason"] is None, f"{label}: non-empty result returned reason")
    items = data["items"]
    require(isinstance(items, list), f"{label}: items must be a list")
    require(len(items) == len(expected), f"{label}: item count differs")
    for offset, (raw_item, oracle) in enumerate(zip(items, expected, strict=True)):
        item = object_keys(raw_item, ITEM_KEYS, f"{label}.items[{offset}]")
        require(item["job_id"] == str(oracle.job_id), f"{label}: Job order differs")
        score = item["score"]
        require(
            isinstance(score, int | float) and not isinstance(score, bool),
            f"{label}: score is not numeric",
        )
        require(
            math.isclose(float(score), oracle.score, abs_tol=3e-7),
            f"{label}: score differs at item {offset}",
        )
    cursor = data["next_cursor"]
    if cursor_expected:
        require(
            isinstance(cursor, str) and 1 <= len(cursor) <= 1024,
            f"{label}: cursor missing",
        )
        require(cursor.isascii(), f"{label}: cursor is not ASCII")
        require(str(SOURCE_CV_ID) not in cursor, f"{label}: cursor leaked source CV")
        require(config.internal_api_key not in cursor, f"{label}: cursor leaked key")
    else:
        require(cursor is None, f"{label}: terminal page returned cursor")
    assert_redacted(config, response.body, response.headers, label)
    return cursor if isinstance(cursor, str) else None


def validate_empty(
    config: BenchmarkConfig,
    response: HttpResult,
    reason: str,
    label: str,
) -> None:
    require(response.status == 200, f"{label}: expected HTTP 200")
    root = object_keys(response.body, SUCCESS_KEYS, label)
    require(root["meta"] is None, f"{label}: meta must be null")
    data = object_keys(root["data"], DATA_KEYS, f"{label}.data")
    require(
        data
        == {
            "cv_id": str(SOURCE_CV_ID),
            "items": [],
            "next_cursor": None,
            "reason": reason,
        },
        f"{label}: empty response differs",
    )
    assert_redacted(config, response.body, response.headers, label)


def validate_error(
    config: BenchmarkConfig,
    response: HttpResult,
    *,
    status: int,
    code: str,
    message: str,
    label: str,
) -> None:
    require(response.status == status, f"{label}: expected HTTP {status}")
    body = object_keys(response.body, ERROR_KEYS, label)
    require(
        body == {"code": code, "message": message, "details": None},
        f"{label}: canonical error differs",
    )
    assert_redacted(config, response.body, response.headers, label)


def verify_auth_and_redaction(config: BenchmarkConfig) -> dict[str, object]:
    payload = {"cv_id": str(SOURCE_CV_ID), "limit": 1}
    invalid_headers = (
        {},
        {"X-Internal-Api-Key": config.internal_api_key},
        {
            "X-Internal-Api-Key": config.internal_api_key,
            "X-Internal-Service": "application-service",
        },
        {
            "X-Internal-Api-Key": "x" * 32,
            "X-Internal-Service": "job-search-service",
        },
    )
    for offset, headers in enumerate(invalid_headers):
        response = post_json(config, payload, headers=headers)
        validate_error(
            config,
            response,
            status=401,
            code="INVALID_INTERNAL_CALLER",
            message="A valid scoped internal caller is required",
            label=f"auth-{offset}",
        )
    invalid = post_json(
        config,
        {"cv_id": str(SOURCE_CV_ID), "limit": 1, "extra": True},
    )
    require(invalid.status == 422, "strict request validation did not return 422")
    invalid_body = object_keys(invalid.body, ERROR_KEYS, "validation")
    require(invalid_body["code"] == "VALIDATION_ERROR", "validation code differs")
    require(
        invalid_body["message"] == "Request validation failed",
        "validation message differs",
    )
    require(isinstance(invalid_body["details"], dict), "validation details missing")
    assert_redacted(config, invalid.body, invalid.headers, "validation")
    return {
        "invalidCallerCases": len(invalid_headers),
        "canonicalUnauthorizedResponses": len(invalid_headers),
        "strictExtraFieldRejected": True,
        "privateKeysLeaked": 0,
        "secretsLeaked": 0,
    }


def verify_walks(
    config: BenchmarkConfig,
    cases: Sequence[QueryCase],
    oracle: Sequence[OracleJob],
) -> dict[str, object]:
    report: dict[str, object] = {}
    for case in cases:
        expected = expected_for(case, oracle)
        cursor: str | None = None
        collected: list[UUID] = []
        page_sizes: list[int] = []
        for page_number in range(1, case.pages + 1):
            response = post_json(config, case.payload(cursor))
            start = (page_number - 1) * case.limit
            page_expected = expected[start : start + case.limit]
            cursor = validate_success(
                config,
                response,
                page_expected,
                cursor_expected=page_number < 10,
                label=f"{case.name}-page-{page_number}",
            )
            page_sizes.append(len(page_expected))
            collected.extend(item.job_id for item in page_expected)
        require(
            len(collected) == len(set(collected)),
            f"{case.name}: page walk duplicated Job IDs",
        )
        report[case.name] = {
            "pages": case.pages,
            "limit": case.limit,
            "pageSizes": page_sizes,
            "items": len(collected),
            "duplicates": 0,
            "oracleMismatches": 0,
            "terminalAtPageTen": case.pages == 10 and cursor is None,
        }

    no_filter = expected_for(cases[0], oracle)[: cases[0].limit * cases[0].pages]
    positions = {item.sequence: offset for offset, item in enumerate(no_filter)}
    require(positions[199] < positions[200], "equal-distance UUID tie order differs")
    tied = [item for item in no_filter if item.sequence in {199, 200}]
    require(len(tied) == 2 and tied[0].score == tied[1].score, "tie scores differ")
    report["uuidTie"] = {
        "sequences": [199, 200],
        "sameScore": True,
        "orderedByUuid": True,
    }
    return report


def verify_isolation(config: BenchmarkConfig) -> dict[str, object]:
    inactive = post_json(
        config,
        {"cv_id": str(SOURCE_CV_ID), "limit": 50, "location": INACTIVE_ONLY_LOCATION},
    )
    wrong_model = post_json(
        config,
        {
            "cv_id": str(SOURCE_CV_ID),
            "limit": 50,
            "location": WRONG_MODEL_ONLY_LOCATION,
        },
    )
    validate_empty(
        config,
        inactive,
        "NO_MATCHING_JOB_EMBEDDINGS",
        "inactive-isolation",
    )
    validate_empty(
        config,
        wrong_model,
        "NO_MATCHING_JOB_EMBEDDINGS",
        "wrong-model-isolation",
    )
    return {
        "inactiveOnlyRows": INACTIVE_MODEL_A,
        "wrongModelOnlyRows": ACTIVE_WRONG_MODEL,
        "inactiveLeaks": 0,
        "wrongModelLeaks": 0,
    }


def target_generation(database_url: str) -> int:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            "SELECT generation FROM ai.recommendation_generations "
            "WHERE target_type='JOBS'"
        ).fetchone()
    require(row is not None and isinstance(row[0], int), "JOBS generation missing")
    return row[0]


def verify_cursor_generation(
    config: BenchmarkConfig,
    case: QueryCase,
    oracle: Sequence[OracleJob],
) -> dict[str, object]:
    expected = expected_for(case, oracle)
    first = post_json(config, case.payload())
    cursor = validate_success(
        config,
        first,
        expected[: case.limit],
        cursor_expected=True,
        label="cursor-committed-first",
    )
    require(cursor is not None, "cursor mutation fixture did not paginate")
    before = target_generation(config.database_url)
    with psycopg.connect(config.database_url) as connection:
        result = connection.execute(
            "UPDATE ai.job_embeddings SET updated_at=clock_timestamp() WHERE job_id=%s",
            (job_id(70_000),),
        )
        require(result.rowcount == 1, "committed mutation target missing")
    after_commit = target_generation(config.database_url)
    require(
        after_commit == before + 1,
        "committed mutation did not bump generation once",
    )
    stale = post_json(config, case.payload(cursor))
    validate_error(
        config,
        stale,
        status=409,
        code="RECOMMENDATION_CURSOR_STALE",
        message="The recommendation data changed; restart pagination",
        label="cursor-committed-stale",
    )

    fresh = post_json(config, case.payload())
    fresh_cursor = validate_success(
        config,
        fresh,
        expected[: case.limit],
        cursor_expected=True,
        label="cursor-stable-first",
    )
    require(fresh_cursor is not None, "fresh cursor missing")
    stable_generation = target_generation(config.database_url)
    with psycopg.connect(config.database_url) as connection:
        zero = connection.execute(
            "UPDATE ai.job_embeddings SET updated_at=clock_timestamp() WHERE job_id=%s",
            (job_id(999_999),),
        )
        require(zero.rowcount == 0, "zero-row mutation unexpectedly found a row")
    after_zero = target_generation(config.database_url)
    with psycopg.connect(config.database_url) as connection:
        rolled_back = connection.execute(
            "UPDATE ai.job_embeddings SET updated_at=clock_timestamp() WHERE job_id=%s",
            (job_id(69_999),),
        )
        require(rolled_back.rowcount == 1, "rollback mutation target missing")
        connection.rollback()
    after_rollback = target_generation(config.database_url)
    require(after_zero == stable_generation, "zero-row mutation bumped generation")
    require(after_rollback == stable_generation, "rollback mutation bumped generation")
    continuation = post_json(config, case.payload(fresh_cursor))
    validate_success(
        config,
        continuation,
        expected[case.limit : case.limit * 2],
        cursor_expected=True,
        label="cursor-stable-continuation",
    )
    return {
        "generationBeforeCommittedMutation": before,
        "generationAfterCommittedMutation": after_commit,
        "committedTargetMutationStale": True,
        "zeroRowMutationStable": True,
        "rolledBackMutationStable": True,
        "stableContinuationStatus": 200,
    }


def walk_plan_nodes(node: Mapping[str, object]) -> Iterable[Mapping[str, object]]:
    yield node
    children = node.get("Plans", [])
    if isinstance(children, list):
        for child in children:
            if isinstance(child, dict):
                yield from walk_plan_nodes(child)


def explain_full_target_plan(
    config: BenchmarkConfig,
    case: QueryCase,
) -> dict[str, object]:
    evidence: dict[str, object] = {}

    class CapturingCursor:
        def __init__(self, inner: Any) -> None:
            self._inner = inner

        def __enter__(self) -> CapturingCursor:
            self._inner.__enter__()
            return self

        def __exit__(self, *arguments: object) -> object:
            return self._inner.__exit__(*arguments)

        def execute(
            self,
            query: str,
            parameters: object | None = None,
        ) -> Any:
            normalized = " ".join(query.split())
            is_job_ranking = (
                "FROM ai.job_embeddings AS j" in normalized
                and "j.vector <=> %(source_vector)s::vector" in normalized
                and "ORDER BY distance ASC, job_id ASC" in normalized
            )
            if is_job_ranking:
                require(
                    "explained" not in evidence,
                    "production ranking query was executed more than once",
                )
                settings = self._inner.execute(
                    """
                    SELECT current_setting('enable_indexscan'),
                           current_setting('enable_bitmapscan'),
                           (
                               extract(
                                   epoch FROM
                                   current_setting('statement_timeout')::interval
                               ) * 1000
                           )::integer
                    """
                ).fetchone()
                require(
                    settings == ("off", "off", STATEMENT_TIMEOUT_MS),
                    "production recommendation call path did not force "
                    "the exact plan and statement timeout",
                )
                require(
                    isinstance(parameters, Mapping),
                    "production ranking parameters are not a mapping",
                )
                explained = self._inner.execute(
                    "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + query,
                    parameters,
                ).fetchone()
                evidence["explained"] = explained
                evidence["callPathSettingsValidated"] = True
            if parameters is None:
                return self._inner.execute(query)
            return self._inner.execute(query, parameters)

    class CapturingConnection:
        def __init__(self, inner: Any) -> None:
            self._inner = inner

        def __enter__(self) -> CapturingConnection:
            self._inner.__enter__()
            return self

        def __exit__(self, *arguments: object) -> object:
            return self._inner.__exit__(*arguments)

        def cursor(self) -> CapturingCursor:
            return CapturingCursor(self._inner.cursor())

    class CallPathRepository(PsycopgRecommendationRepository):
        def _connect(self) -> CapturingConnection:
            return CapturingConnection(
                psycopg.connect(
                    config.database_url,
                    connect_timeout=2,
                )
            )

    filters = JobRecommendationFilters(
        location=(
            " ".join(unicodedata.normalize("NFKC", case.location).split())
            if case.location is not None
            else None
        ),
        salary_min=case.salary_min,
        job_type=case.job_type,
    )
    repository = CallPathRepository(
        config.database_url,
        connect_timeout_seconds=2,
        statement_timeout_ms=STATEMENT_TIMEOUT_MS,
    )
    page = repository.recommend_jobs(
        SOURCE_CV_ID,
        filters,
        limit=case.limit,
        boundary=None,
        expected_source_fingerprint=None,
    )
    require(
        len(page.items) == case.limit and page.reason is None,
        "production recommendation call path did not return a full page",
    )
    explained = evidence.get("explained")
    require(
        isinstance(explained, tuple)
        and len(explained) == 1
        and isinstance(explained[0], list),
        "EXPLAIN JSON missing",
    )
    document = explained[0][0]
    require(isinstance(document, dict), "EXPLAIN document invalid")
    root = document.get("Plan")
    require(isinstance(root, dict), "EXPLAIN root plan missing")
    nodes = list(walk_plan_nodes(root))
    job_nodes = [
        node for node in nodes if node.get("Relation Name") == "job_embeddings"
    ]
    indexes = sorted(
        {str(node["Index Name"]) for node in nodes if node.get("Index Name")}
    )
    require(job_nodes, "EXPLAIN did not access job_embeddings")
    require(
        any(node.get("Node Type") == "Seq Scan" for node in job_nodes),
        "production exact query did not use a full-target sequential scan",
    )
    require(INDEX_NAME not in indexes, "production exact query used Job HNSW")
    scanned = max(
        round(
            (
                float(node.get("Actual Rows", 0))
                + float(node.get("Rows Removed by Filter", 0))
            )
            * float(node.get("Actual Loops", 1))
        )
        for node in job_nodes
    )
    require(
        abs(scanned - DATASET_SIZE) <= 64,
        f"exact plan scanned about {scanned} rows, expected 100000",
    )
    execution_ms = document.get("Execution Time")
    require(
        isinstance(execution_ms, int | float),
        "EXPLAIN execution time missing",
    )
    require(float(execution_ms) <= STATEMENT_TIMEOUT_MS, "EXPLAIN exceeded DB timeout")
    return {
        "case": case.name,
        "executionMs": execution_ms,
        "jobNodeTypes": sorted({str(node.get("Node Type")) for node in job_nodes}),
        "scannedRows": scanned,
        "indexes": indexes,
        "usesFullTargetSeqScan": True,
        "usesHnsw": False,
        "statementTimeoutMs": STATEMENT_TIMEOUT_MS,
        "queryOrigin": "PsycopgRecommendationRepository.recommend_jobs",
        "callPathSettingsValidated": evidence.get("callPathSettingsValidated") is True,
    }


def verify_concurrent_writer(
    config: BenchmarkConfig,
    case: QueryCase,
    oracle: Sequence[OracleJob],
) -> dict[str, object]:
    expected = expected_for(case, oracle)
    reader_count = 6
    writer_commits = 6
    barrier = threading.Barrier(reader_count + 1)
    first_commit = threading.Event()
    barrier_timeout = max(60, config.http_timeout_seconds * 3)
    before = target_generation(config.database_url)

    def reader(index: int) -> int:
        try:
            first = post_json(config, case.payload())
            cursor = validate_success(
                config,
                first,
                expected[: case.limit],
                cursor_expected=True,
                label=f"concurrent-first-{index}",
            )
            require(cursor is not None, "concurrent first page cursor missing")
            barrier.wait(timeout=barrier_timeout)
            if index % 2 == 0:
                require(first_commit.wait(barrier_timeout), "writer did not commit")
            continuation = post_json(config, case.payload(cursor))
            if continuation.status == 200:
                validate_success(
                    config,
                    continuation,
                    expected[case.limit : case.limit * 2],
                    cursor_expected=True,
                    label=f"concurrent-continuation-{index}",
                )
                return 200
            validate_error(
                config,
                continuation,
                status=409,
                code="RECOMMENDATION_CURSOR_STALE",
                message="The recommendation data changed; restart pagination",
                label=f"concurrent-stale-{index}",
            )
            return 409
        except Exception:
            barrier.abort()
            first_commit.set()
            raise

    def writer() -> None:
        try:
            barrier.wait(timeout=barrier_timeout)
            with psycopg.connect(config.database_url) as connection:
                for offset in range(writer_commits):
                    result = connection.execute(
                        "UPDATE ai.job_embeddings SET updated_at=clock_timestamp() "
                        "WHERE job_id=%s",
                        (job_id(71_000 + offset),),
                    )
                    require(result.rowcount == 1, "concurrent writer target missing")
                    connection.commit()
                    if offset == 0:
                        first_commit.set()
                    time.sleep(0.01)
        finally:
            first_commit.set()

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=reader_count + 1
    ) as executor:
        reader_futures = [
            executor.submit(reader, index) for index in range(reader_count)
        ]
        writer_future = executor.submit(writer)
        outcomes = [future.result() for future in reader_futures]
        writer_future.result()
    after = target_generation(config.database_url)
    require(after == before + writer_commits, "concurrent writer generation differs")
    counts = Counter(outcomes)
    require(set(counts).issubset({200, 409}), "unexpected concurrent outcome")
    require(
        counts[409] >= reader_count // 2,
        "forced post-commit readers were not stale",
    )
    return {
        "readers": reader_count,
        "writerCommits": writer_commits,
        "http200ExactContinuations": counts[200],
        "canonicalStale409": counts[409],
        "unexpectedOutcomes": 0,
        "generationBefore": before,
        "generationAfter": after,
    }


def percentile(values: Sequence[float], quantile: float) -> float:
    require(bool(values), "cannot calculate percentile of empty sample")
    ordered = sorted(values)
    rank = max(0, math.ceil(quantile * len(ordered)) - 1)
    return ordered[rank]


def benchmark_call(
    config: BenchmarkConfig,
    case: QueryCase,
    expected: Sequence[OracleJob],
) -> tuple[str, float, bool, str | None, bool]:
    try:
        response = post_json(config, case.payload())
    except HttpTransportFailure as error:
        return case.name, error.latency_ms, False, error.kind, error.kind == "TIMEOUT"
    try:
        if response.status != 200:
            return (
                case.name,
                response.latency_ms,
                False,
                f"HTTP_{response.status}",
                False,
            )
        validate_success(
            config,
            response,
            expected[: case.limit],
            cursor_expected=True,
            label=f"load-{case.name}",
        )
        return case.name, response.latency_ms, False, None, False
    except Exception as error:  # noqa: BLE001 - every wire mismatch must be counted.
        return case.name, response.latency_ms, True, type(error).__name__, False


def run_load_gate(
    config: BenchmarkConfig,
    cases: Sequence[QueryCase],
    oracle: Sequence[OracleJob],
) -> dict[str, object]:
    expected = {case.name: expected_for(case, oracle) for case in cases}

    def invoke(index: int) -> tuple[str, float, bool, str | None, bool]:
        case = cases[index % len(cases)]
        return benchmark_call(config, case, expected[case.name])

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=config.concurrency
    ) as executor:
        warmup = list(executor.map(invoke, range(config.warmup_calls)))
        require(
            not any(mismatch or error for _, _, mismatch, error, _ in warmup),
            "warm-up request failed or differed from the independent oracle",
        )
        started = time.perf_counter()
        results = list(executor.map(invoke, range(config.measured_calls)))
        duration = time.perf_counter() - started

    errors = sum(
        error is not None for _, _, mismatch, error, _ in results if not mismatch
    )
    mismatches = sum(mismatch for _, _, mismatch, _, _ in results)
    timeouts = sum(timeout for _, _, _, _, timeout in results)
    latencies = [latency for _, latency, _, _, _ in results]
    p95 = percentile(latencies, 0.95)
    p99 = percentile(latencies, 0.99)
    maximum = max(latencies)
    rps = config.measured_calls / duration
    grouped: dict[str, list[float]] = defaultdict(list)
    grouped_errors: Counter[str] = Counter()
    grouped_mismatches: Counter[str] = Counter()
    for name, latency, mismatch, error, _ in results:
        grouped[name].append(latency)
        grouped_errors[name] += int(error is not None and not mismatch)
        grouped_mismatches[name] += int(mismatch)
    require(errors == 0, f"measured recommendation errors: {errors}")
    require(mismatches == 0, f"measured oracle/contract mismatches: {mismatches}")
    require(timeouts == 0, f"measured recommendation timeouts: {timeouts}")
    require(p95 <= config.max_p95_ms, f"p95 {p95:.3f}ms exceeded threshold")
    require(p99 <= config.max_p99_ms, f"p99 {p99:.3f}ms exceeded threshold")
    require(maximum <= config.max_call_ms, f"max {maximum:.3f}ms exceeded threshold")
    require(rps >= config.min_rps, f"throughput {rps:.3f} RPS below threshold")
    per_case = {
        name: {
            "requests": len(values),
            "errors": grouped_errors[name],
            "oracleMismatches": grouped_mismatches[name],
            "p50Ms": round(percentile(values, 0.50), 3),
            "p95Ms": round(percentile(values, 0.95), 3),
            "p99Ms": round(percentile(values, 0.99), 3),
            "maxMs": round(max(values), 3),
        }
        for name, values in sorted(grouped.items())
    }
    return {
        "warmupCalls": config.warmup_calls,
        "measuredCalls": config.measured_calls,
        "concurrency": config.concurrency,
        "durationMs": round(duration * 1_000, 3),
        "requestsPerSecond": round(rps, 3),
        "errors": errors,
        "oracleMismatches": mismatches,
        "timeouts": timeouts,
        "p50Ms": round(percentile(latencies, 0.50), 3),
        "p95Ms": round(p95, 3),
        "p99Ms": round(p99, 3),
        "maxMs": round(maximum, 3),
        "thresholds": {
            "maxP95Ms": config.max_p95_ms,
            "maxP99Ms": config.max_p99_ms,
            "maxCallMs": config.max_call_ms,
            "minRequestsPerSecond": config.min_rps,
            "httpTimeoutSeconds": config.http_timeout_seconds,
            "databaseStatementTimeoutMs": STATEMENT_TIMEOUT_MS,
        },
        "perCase": per_case,
    }


def main() -> None:
    config = validate_environment()
    database = validate_database(config)
    fixture = seed_fixture(config)
    oracle = build_oracle()
    cases = (
        QueryCase("no-filter", pages=10, limit=50),
        QueryCase("location", pages=2, limit=50, location="  HÀ   NỘI  "),
        QueryCase("salary", pages=1, limit=50, salary_min=Decimal("25000000.00")),
        QueryCase("job-type", pages=1, limit=50, job_type="FULL_TIME"),
    )
    auth = verify_auth_and_redaction(config)
    walks = verify_walks(config, cases, oracle)
    isolation = verify_isolation(config)
    cursor = verify_cursor_generation(config, cases[0], oracle)
    plans = [
        explain_full_target_plan(config, cases[0]),
        explain_full_target_plan(config, cases[1]),
    ]
    concurrent_writer = verify_concurrent_writer(config, cases[0], oracle)
    load = run_load_gate(config, cases, oracle)
    report = {
        "gate": GATE_NAME,
        "status": "PASS",
        "errors": 0,
        "mismatches": 0,
        "timeouts": 0,
        "securityLeaks": 0,
        "database": database,
        "dataset": fixture,
        "httpContract": auth,
        "correctness": {
            "walks": walks,
            "isolation": isolation,
            "oracle": "independent-python-float32-cosine",
        },
        "cursorGeneration": cursor,
        "concurrentWriter": concurrent_writer,
        "plans": plans,
        "load": load,
        "images": config.images,
        "boundary": {
            "productionSloClaimed": False,
            "realVietnameseSemanticRelevanceClaimed": False,
            "distributedRateLimitAdded": False,
        },
    }
    print(json.dumps(report, sort_keys=True, separators=(",", ":")), flush=True)
    print(
        "[job-recommendation-benchmark] PASS: "
        "100k full-target fixture, strict HTTP correctness and bounded load",
        flush=True,
    )


if __name__ == "__main__":
    main()
