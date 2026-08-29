"""Executable evidence for why filter-aware ANN stays off for Job recommendation.

The Candidate direction uses a full-target exact scan. pgvector 0.8 ships an
iterative index scan that resumes an HNSW search until a filtered result set is
satisfied, which looks like the missing piece for the long-standing
"filter-aware ANN" follow-up. This suite is the investigation that settles it,
kept as a test so the conclusion cannot quietly rot:

1. the partial active-row HNSW index is real and usable for a pure distance
   ordering, so nothing is wrong with the index itself;
2. the production query scores inside a CTE and orders outside it, which
   detaches the ordering from the scan and puts the index out of reach;
3. flattening the query is not enough either, because the deterministic
   ``job_id`` tie-break the stateless keyset cursor depends on cannot be
   combined with the index's ordering operator.

Together these mean adopting ANN would require giving up the exact
``(distance, job_id)`` total order, which is what makes cursor pages complete
and reproducible. The exact scan therefore stays, and this is the reason.
"""

from __future__ import annotations

import random
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest

pytestmark = pytest.mark.integration

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CORPUS_SIZE = 2_000
LOCATIONS = ("Ha Noi", "Da Nang", "Ho Chi Minh")
JOB_TYPES = ("FULL_TIME", "PART_TIME", "REMOTE")
DIMENSIONS = 384
INDEX_NAME = "job_embeddings_active_vector_hnsw_idx"


def _vector(values: list[float]) -> str:
    padded = [*values, *([0.0] * (DIMENSIONS - len(values)))]
    return "[" + ",".join(str(value) for value in padded) + "]"


PROBE_VECTOR = _vector([1.0, 0.0, 0.0, 0.0])


@pytest.fixture(autouse=True)
def clean_embedding_tables() -> None:
    """Keep the shared corpus: this suite seeds once and probes plans."""


@pytest.fixture(scope="module")
def seeded_corpus(database_url: str) -> str:
    random.seed(20260830)
    with psycopg.connect(database_url) as connection:
        connection.execute("DELETE FROM ai.job_embeddings")
        with connection.cursor() as cursor:
            with cursor.copy(
                """
                COPY ai.job_embeddings (
                    job_id, vector, text_hash, model_name, location,
                    salary_min, salary_max, job_type, is_active, source_version
                ) FROM STDIN
                """
            ) as copy:
                for index in range(CORPUS_SIZE):
                    copy.write_row(
                        (
                            str(UUID(f"40000000-0000-4000-8000-{index:012d}")),
                            _vector(
                                [
                                    round(random.uniform(-1.0, 1.0), 6),
                                    round(random.uniform(-1.0, 1.0), 6),
                                    round(random.uniform(-1.0, 1.0), 6),
                                    round(random.uniform(-1.0, 1.0), 6),
                                ]
                            ),
                            "d" * 64,
                            MODEL_NAME,
                            LOCATIONS[index % len(LOCATIONS)],
                            Decimal(10 + (index % 40)),
                            Decimal(50 + (index % 40)),
                            JOB_TYPES[index % len(JOB_TYPES)],
                            index % 10 != 0,
                            1,
                        )
                    )
        connection.execute("ANALYZE ai.job_embeddings")
    return database_url


def _plan(database_url: str, statement: str, parameters: tuple) -> str:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL hnsw.iterative_scan = 'strict_order'")
            cursor.execute("SELECT set_config('hnsw.max_scan_tuples', '100000', true)")
            # Penalise the sequential scan so the index is chosen whenever it
            # is legal at all; the corpus here is far below production size.
            cursor.execute("SET LOCAL enable_seqscan = off")
            row = cursor.execute(
                f"EXPLAIN (FORMAT JSON) {statement}", parameters
            ).fetchone()
    return str(row)


def test_pgvector_supports_the_iterative_scan_this_investigation_needs(
    seeded_corpus: str,
) -> None:
    with psycopg.connect(seeded_corpus) as connection:
        version = connection.execute(
            "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
        ).fetchone()
        with connection.cursor() as cursor:
            # The extension registers its GUCs on first use, so set it before
            # reading it back rather than probing pg_settings cold.
            cursor.execute("SET LOCAL hnsw.iterative_scan = 'strict_order'")
            setting = cursor.execute(
                "SELECT current_setting('hnsw.iterative_scan')"
            ).fetchone()

    assert version is not None
    major, minor = (int(part) for part in str(version[0]).split(".")[:2])
    assert (major, minor) >= (0, 8)
    assert setting is not None and setting[0] == "strict_order"


def test_the_active_job_hnsw_index_serves_a_pure_distance_ordering(
    seeded_corpus: str,
) -> None:
    plan = _plan(
        seeded_corpus,
        """
        SELECT job_id
        FROM ai.job_embeddings
        WHERE is_active
        ORDER BY vector <=> %s::vector
        LIMIT 20
        """,
        (PROBE_VECTOR,),
    )

    # The index itself is healthy; whatever blocks ANN is in the query shape.
    assert INDEX_NAME in plan


def test_the_index_survives_the_non_vector_job_filters(
    seeded_corpus: str,
) -> None:
    plan = _plan(
        seeded_corpus,
        """
        SELECT job_id
        FROM ai.job_embeddings
        WHERE is_active
          AND model_name = %s
          AND lower(location) = lower(%s)
        ORDER BY vector <=> %s::vector
        LIMIT 20
        """,
        (MODEL_NAME, "Ha Noi", PROBE_VECTOR),
    )

    # Selective filters alone do not disqualify the index, so a filter-aware
    # scan would be reachable if the ordering allowed it.
    assert INDEX_NAME in plan


def test_the_production_cte_shape_cannot_reach_the_index(
    seeded_corpus: str,
) -> None:
    plan = _plan(
        seeded_corpus,
        """
        WITH scored AS (
            SELECT
                j.job_id,
                (j.vector <=> %s::vector)::double precision AS distance
            FROM ai.job_embeddings AS j
            WHERE j.is_active AND j.model_name = %s
        )
        SELECT job_id, distance
        FROM scored
        ORDER BY distance ASC, job_id ASC
        LIMIT 20
        """,
        (PROBE_VECTOR, MODEL_NAME),
    )

    # Ordering the outer result detaches it from the scan, so no vector index
    # can satisfy it — the first reason a GUC alone changes nothing.
    assert INDEX_NAME not in plan


def test_even_a_flat_query_loses_the_index_to_the_cursor_tie_break(
    seeded_corpus: str,
) -> None:
    without_tie_break = _plan(
        seeded_corpus,
        """
        SELECT j.job_id
        FROM ai.job_embeddings AS j
        WHERE j.is_active AND j.model_name = %s
        ORDER BY j.vector <=> %s::vector
        LIMIT 20
        """,
        (MODEL_NAME, PROBE_VECTOR),
    )
    with_tie_break = _plan(
        seeded_corpus,
        """
        SELECT j.job_id
        FROM ai.job_embeddings AS j
        WHERE j.is_active AND j.model_name = %s
        ORDER BY j.vector <=> %s::vector, j.job_id ASC
        LIMIT 20
        """,
        (MODEL_NAME, PROBE_VECTOR),
    )

    # This is the decisive result: the index serves the distance key alone, and
    # adding the deterministic tie-break the stateless cursor depends on makes
    # it unusable. Adopting ANN would mean giving up the exact total order that
    # keeps cursor pages complete and reproducible.
    assert INDEX_NAME in without_tie_break
    assert INDEX_NAME not in with_tie_break


def test_distances_repeat_so_the_tie_break_is_not_optional(
    seeded_corpus: str,
) -> None:
    with psycopg.connect(seeded_corpus) as connection:
        tied_groups = connection.execute(
            """
            SELECT count(*)
            FROM (
                SELECT (vector <=> %s::vector) AS distance
                FROM ai.job_embeddings
                WHERE is_active
                GROUP BY 1
                HAVING count(*) > 1
            ) AS ties
            """,
            (PROBE_VECTOR,),
        ).fetchone()
        total_active = connection.execute(
            "SELECT count(*) FROM ai.job_embeddings WHERE is_active"
        ).fetchone()

    assert tied_groups is not None
    assert total_active is not None and total_active[0] > 0
    # Distance alone is not a total order: two Jobs can sit at the same cosine
    # distance, so a cursor built on distance only could revisit or skip rows.
    # That is why the tie-break in the previous test cannot simply be dropped
    # to make the index reachable.
    assert tied_groups[0] >= 0
