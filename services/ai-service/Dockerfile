FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY alembic.ini .
COPY migrations migrations
COPY app app
RUN groupadd --system app && useradd --system --gid app --home /app app

FROM base AS test
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY pyproject.toml .
COPY tests tests
CMD ["sh", "-c", "ruff check app tests migrations && ruff format --check app tests migrations && python -m pytest -q"]

FROM base AS runtime
USER app
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]

FROM base AS worker-dependencies
COPY requirements-ml.txt .
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements-ml.txt
RUN mkdir -p /models/huggingface /models/.cache \
    && chown -R app:app /models

FROM worker-dependencies AS worker
ENV EMBEDDING_MODEL_CACHE=/models \
    HF_HOME=/models/huggingface \
    XDG_CACHE_HOME=/models/.cache
USER app
CMD ["python", "-m", "app.worker_main"]

