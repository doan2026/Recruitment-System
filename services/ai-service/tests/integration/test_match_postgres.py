from __future__ import annotations

import os
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import MatchStoreUnavailable, PsycopgMatchRepository
from app.main import create_app

pytestmark = pytest.mark.integration

SERVICE_ROOT = Path(__file__).resolve().parents[2]
CV_ID = UUID("10000000-0000-0000-0000-000000000001")
JOB_ID = UUID("20000000-0000-0000-0000-000000000001")
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
INTERNAL_API_KEY = "integration-test-internal-key"
SCOPED_JOB_KEY = "integration-job-search-key-00000001"
SCOPED_CANDIDATE_KEY = "integration-candidate-key-00000000001"


def test_migration_creates_versioned_private_vector_store(
    database_url: str,
) -> None:
    with psycopg.connect(database_url) as connection:
        extension = connection.execute(
            "SELECT extname FROM pg_extension WHERE extname = 'vector'"
        ).fetchone()
        tables = connection.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'ai'
            ORDER BY table_name
            """
        ).fetchall()
        columns = connection.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'ai'
              AND table_name IN ('cv_embeddings', 'job_embeddings')
            """
        ).fetchall()
        index_definitions = connection.execute(
            """
            SELECT
                index_relation.relname,
                pg_get_indexdef(index_state.indexrelid),
                index_state.indisvalid,
                index_state.indisready,
                access_method.amname
            FROM pg_index AS index_state
            JOIN pg_class AS index_relation
              ON index_relation.oid = index_state.indexrelid
            JOIN pg_namespace AS index_namespace
              ON index_namespace.oid = index_relation.relnamespace
            JOIN pg_am AS access_method
              ON access_method.oid = index_relation.relam
            WHERE index_namespace.nspname = 'ai'
              AND index_relation.relname IN (
                'cv_embeddings_active_vector_hnsw_idx',
                'job_embeddings_active_vector_hnsw_idx'
              )
            ORDER BY index_relation.relname
            """
        ).fetchall()
        migration_version = connection.execute(
            "SELECT version_num FROM ai.alembic_version"
        ).fetchone()
        recommendation_generations = connection.execute(
            """
            SELECT target_type, generation
            FROM ai.recommendation_generations
            ORDER BY target_type
            """
        ).fetchall()
        recommendation_triggers = connection.execute(
            """
            SELECT
                tgname,
                tgenabled,
                tgtype,
                tgfoid =
                  'ai.bump_recommendation_generation()'::regprocedure
            FROM pg_trigger
            WHERE NOT tgisinternal
              AND tgname LIKE '%_recommendation_%'
            ORDER BY tgname
            """
        ).fetchall()

    assert extension == ("vector",)
    assert {row[0] for row in tables} >= {
        "alembic_version",
        "cv_embeddings",
        "job_embeddings",
        "recommendation_generations",
    }
    assert migration_version == ("20260829_06",)
    assert [target for target, _ in recommendation_generations] == ["CVS", "JOBS"]
    assert all(generation > 0 for _, generation in recommendation_generations)
    assert recommendation_triggers == [
        ("cv_embeddings_recommendation_generation", "O", 29, True),
        ("cv_embeddings_recommendation_truncate", "O", 32, True),
        ("job_embeddings_recommendation_generation", "O", 29, True),
        ("job_embeddings_recommendation_truncate", "O", 32, True),
    ]
    assert [name for name, *_ in index_definitions] == [
        "cv_embeddings_active_vector_hnsw_idx",
        "job_embeddings_active_vector_hnsw_idx",
    ]
    for _, definition, is_valid, is_ready, access_method in index_definitions:
        assert is_valid is True
        assert is_ready is True
        assert access_method == "hnsw"
        assert "USING hnsw" in definition
        assert "vector_cosine_ops" in definition
        assert "WHERE is_active" in definition
    assert "m='16'" in index_definitions[0][1]
    assert "ef_construction='64'" in index_definitions[0][1]
    forbidden_columns = {"content", "content_json", "description", "raw_text"}
    assert forbidden_columns.isdisjoint({column for _, column in columns})


def test_migration_can_be_run_again_at_head(database_url: str) -> None:
    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    command.upgrade(Config(str(SERVICE_ROOT / "alembic.ini")), "head")
    if previous_url is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = previous_url

    with psycopg.connect(database_url) as connection:
        versions = connection.execute(
            "SELECT count(*) FROM ai.alembic_version"
        ).fetchone()
    assert versions == (1,)


def test_cv_ann_migration_replaces_wrong_leftover_index(
    database_url: str,
) -> None:
    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    config = Config(str(SERVICE_ROOT / "alembic.ini"))
    try:
        command.downgrade(config, "20260828_05")
        with psycopg.connect(database_url) as connection:
            connection.execute(
                """
                CREATE INDEX cv_embeddings_active_vector_hnsw_idx
                ON ai.cv_embeddings (cv_id)
                WHERE is_active
                """
            )
        command.upgrade(config, "head")
    finally:
        if previous_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_url

    with psycopg.connect(database_url) as connection:
        version = connection.execute(
            "SELECT version_num FROM ai.alembic_version"
        ).fetchone()
        index_state = connection.execute(
            """
            SELECT
                pg_get_indexdef(index_catalog.indexrelid),
                index_catalog.indisvalid,
                index_catalog.indisready,
                access_method.amname
            FROM pg_index AS index_catalog
            JOIN pg_class AS index_relation
              ON index_relation.oid = index_catalog.indexrelid
            JOIN pg_namespace AS index_namespace
              ON index_namespace.oid = index_relation.relnamespace
            JOIN pg_am AS access_method
              ON access_method.oid = index_relation.relam
            WHERE index_namespace.nspname = 'ai'
              AND index_relation.relname =
                'cv_embeddings_active_vector_hnsw_idx'
            """
        ).fetchone()

    assert version == ("20260829_06",)
    assert index_state is not None
    definition, is_valid, is_ready, access_method = index_state
    assert is_valid is True
    assert is_ready is True
    assert access_method == "hnsw"
    assert "USING hnsw" in definition
    assert "vector_cosine_ops" in definition


@pytest.mark.parametrize(
    ("cv_values", "job_values", "expected_score"),
    [
        ((1.0, 0.0), (1.0, 0.0), 1.0),
        ((1.0, 0.0), (0.0, 1.0), 0.5),
        ((1.0, 0.0), (-1.0, 0.0), 0.0),
    ],
)
def test_repository_maps_cosine_similarity_without_clamping(
    database_url: str,
    cv_values: tuple[float, float],
    job_values: tuple[float, float],
    expected_score: float,
) -> None:
    _insert_cv(database_url, vector=_vector(*cv_values))
    _insert_job(database_url, vector=_vector(*job_values))

    result = _repository(database_url).calculate(CV_ID, JOB_ID)

    assert result.reason is None
    assert result.score == pytest.approx(expected_score, abs=1e-12)


@pytest.mark.parametrize(
    ("seed_cv", "seed_job", "expected_reason"),
    [
        (False, False, "CV_AND_JOB_EMBEDDINGS_NOT_FOUND"),
        (False, True, "CV_EMBEDDING_NOT_FOUND"),
        (True, False, "JOB_EMBEDDING_NOT_FOUND"),
    ],
)
def test_repository_returns_stable_missing_embedding_reason(
    database_url: str,
    seed_cv: bool,
    seed_job: bool,
    expected_reason: str,
) -> None:
    if seed_cv:
        _insert_cv(database_url)
    if seed_job:
        _insert_job(database_url)

    result = _repository(database_url).calculate(CV_ID, JOB_ID)

    assert result.score is None
    assert result.reason == expected_reason


def test_repository_treats_inactive_job_embedding_as_missing(
    database_url: str,
) -> None:
    _insert_cv(database_url)
    _insert_job(database_url, is_active=False)

    result = _repository(database_url).calculate(CV_ID, JOB_ID)

    assert result.score is None
    assert result.reason == "JOB_EMBEDDING_NOT_FOUND"


def test_repository_rejects_embeddings_from_different_models(
    database_url: str,
) -> None:
    _insert_cv(database_url)
    _insert_job(database_url, model_name="different-model")

    result = _repository(database_url).calculate(CV_ID, JOB_ID)

    assert result.score is None
    assert result.reason == "EMBEDDING_MODEL_MISMATCH"


def test_zero_vector_never_produces_non_finite_json_score(
    database_url: str,
) -> None:
    _insert_cv(database_url, vector=_vector(0.0, 0.0))
    _insert_job(database_url)

    with pytest.raises(MatchStoreUnavailable):
        _repository(database_url).calculate(CV_ID, JOB_ID)


def test_database_rejects_wrong_vector_dimension(database_url: str) -> None:
    with (
        pytest.raises(psycopg.errors.DataException),
        psycopg.connect(database_url) as connection,
    ):
        connection.execute(
            """
            INSERT INTO ai.cv_embeddings (
                cv_id, user_id, vector, text_hash, model_name
            ) VALUES (%s, %s, %s::vector, %s, %s)
            """,
            (CV_ID, CV_ID, "[1,0,0]", "a" * 64, MODEL_NAME),
        )


def test_match_endpoint_uses_real_pgvector_result(database_url: str) -> None:
    _insert_cv(database_url, vector=_vector(1.0, 0.0))
    _insert_job(database_url, vector=_vector(0.0, 1.0))
    app = create_app(
        settings=Settings(
            database_url=database_url,
            internal_api_key=INTERNAL_API_KEY,
            internal_api_key_job_search=SCOPED_JOB_KEY,
            internal_api_key_job_search_candidates=SCOPED_CANDIDATE_KEY,
        )
    )

    with TestClient(app) as client:
        readiness = client.get("/ready")
        response = client.post(
            "/match",
            headers={"X-Internal-Api-Key": INTERNAL_API_KEY},
            json={"cv_id": str(CV_ID), "job_id": str(JOB_ID)},
        )

    assert readiness.status_code == 200
    assert readiness.json() == {
        "service": "ai-service",
        "status": "READY",
    }
    assert response.status_code == 200
    assert response.json() == {
        "data": {
            "cv_id": str(CV_ID),
            "job_id": str(JOB_ID),
            "score": 0.5,
            "reason": None,
        },
        "meta": None,
    }


@pytest.mark.parametrize("trigger_mode", ["DISABLE", "ENABLE REPLICA"])
def test_readiness_rejects_trigger_that_will_not_run_for_origin_sessions(
    database_url: str,
    trigger_mode: str,
) -> None:
    trigger_name = "job_embeddings_recommendation_generation"
    repository = _repository(database_url)
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(
            f"ALTER TABLE ai.job_embeddings {trigger_mode} TRIGGER {trigger_name}"
        )
    try:
        with pytest.raises(MatchStoreUnavailable):
            repository.check()
    finally:
        with psycopg.connect(database_url, autocommit=True) as connection:
            connection.execute(
                f"ALTER TABLE ai.job_embeddings ENABLE TRIGGER {trigger_name}"
            )

    repository.check()


def _repository(database_url: str) -> PsycopgMatchRepository:
    return PsycopgMatchRepository(
        database_url,
        connect_timeout_seconds=2,
        statement_timeout_ms=2_000,
    )


def _insert_cv(
    database_url: str,
    *,
    vector: str | None = None,
    model_name: str = MODEL_NAME,
) -> None:
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            INSERT INTO ai.cv_embeddings (
                cv_id, user_id, vector, text_hash, model_name
            ) VALUES (%s, %s, %s::vector, %s, %s)
            """,
            (CV_ID, CV_ID, vector or _vector(1.0, 0.0), "a" * 64, model_name),
        )


def _insert_job(
    database_url: str,
    *,
    vector: str | None = None,
    model_name: str = MODEL_NAME,
    is_active: bool = True,
) -> None:
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            INSERT INTO ai.job_embeddings (
                job_id, vector, text_hash, model_name, is_active
            ) VALUES (%s, %s::vector, %s, %s, %s)
            """,
            (JOB_ID, vector or _vector(1.0, 0.0), "b" * 64, model_name, is_active),
        )


def _vector(first: float, second: float) -> str:
    values = [first, second, *([0.0] * 382)]
    return "[" + ",".join(str(value) for value in values) + "]"
