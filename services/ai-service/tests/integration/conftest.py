from __future__ import annotations

import os
from pathlib import Path

import psycopg
import pytest
from alembic import command
from alembic.config import Config

SERVICE_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.getenv("AI_TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("AI_TEST_DATABASE_URL is required for integration tests")
    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url
    command.upgrade(Config(str(SERVICE_ROOT / "alembic.ini")), "head")
    if previous_url is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = previous_url
    return url


@pytest.fixture(autouse=True)
def clean_embedding_tables(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            TRUNCATE
                ai.embedding_dead_letters,
                ai.embedding_event_ledger,
                ai.embedding_aggregate_cursors,
                ai.cv_embeddings,
                ai.job_embeddings
            RESTART IDENTITY
            """
        )
