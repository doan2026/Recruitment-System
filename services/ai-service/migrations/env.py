"""Alembic environment for the isolated ``ai`` PostgreSQL schema."""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def _database_url() -> str:
    raw_url = os.getenv("DATABASE_URL", "").strip()
    if not raw_url:
        raise RuntimeError("DATABASE_URL must be configured for migrations")
    if "schema=" in raw_url:
        raise RuntimeError(
            "DATABASE_URL must be a libpq URL without the unsupported schema query"
        )
    if raw_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + raw_url.removeprefix("postgresql://")
    return raw_url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        version_table_schema="ai",
    )
    with context.begin_transaction():
        context.execute("CREATE SCHEMA IF NOT EXISTS ai")
        context.run_migrations()


def run_migrations_online() -> None:
    escaped_url = _database_url().replace("%", "%%")
    config.set_main_option("sqlalchemy.url", escaped_url)
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS ai"))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            version_table_schema="ai",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
