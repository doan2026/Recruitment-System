# AI Service

FastAPI service for CV-to-job semantic matching. This vertical slice owns the
pgvector schema and the internal `POST /match` provider used by Application
Service. Kafka ingestion, recommendation and chatbot implementation remain
separate P11 tasks.

## Internal match API

Application Service calls the container directly at `POST /match`; through the
gateway the same route is `POST /ai/match`. The caller must send the shared
`X-Internal-Api-Key`.

```json
{
  "cv_id": "10000000-0000-0000-0000-000000000001",
  "job_id": "20000000-0000-0000-0000-000000000001"
}
```

When both embeddings exist and use the same model, the response is:

```json
{
  "data": {
    "cv_id": "10000000-0000-0000-0000-000000000001",
    "job_id": "20000000-0000-0000-0000-000000000001",
    "score": 0.85456,
    "reason": null
  },
  "meta": null
}
```

The score maps cosine similarity from `[-1, 1]` to `[0, 1]` without clamping:

```text
score = (cosine_similarity + 1) / 2
      = 1 - cosine_distance / 2
```

Missing or incompatible embeddings still return HTTP 200 with `score: null`
and exactly one stable reason:

- `CV_EMBEDDING_NOT_FOUND`
- `JOB_EMBEDDING_NOT_FOUND`
- `CV_AND_JOB_EMBEDDINGS_NOT_FOUND`
- `EMBEDDING_MODEL_MISMATCH`

Missing/invalid internal credentials return 401, invalid request bodies return
422, and an unavailable or corrupt vector store returns 503. Errors use
`{ code, message, details }` and never include vectors or source content.

## Vector storage and migrations

Alembic owns `ai.cv_embeddings`, `ai.job_embeddings` and its version table.
Both vector columns are fixed at 384 dimensions. Job vectors have a partial
HNSW cosine index for the future recommendation query. Only vectors, hashes,
model identity and minimal filtering metadata are stored; original CV/job text
is intentionally absent. A CV nearest-neighbor index is intentionally deferred
until the recommend-candidates query and its filtering/load profile are
implemented.

Run migrations from this directory:

```bash
alembic upgrade head
```

The container runs the same command before Uvicorn starts. PostgreSQL must use
the pgvector image/extension and `DATABASE_URL` must be a normal libpq URL,
without Prisma's unsupported `?schema=ai` query parameter.

## Configuration

Copy `.env.example` to `.env` and set at least:

- `DATABASE_URL`
- `INTERNAL_API_KEY` — exactly the same secret as Application Service
- `DATABASE_CONNECT_TIMEOUT_SECONDS` (default 2)
- `DATABASE_STATEMENT_TIMEOUT_MS` (default 2000)

The process fails at startup if `DATABASE_URL` or `INTERNAL_API_KEY` is empty.
Define `INTERNAL_API_KEY` once in the repository root `.env`; the Application,
Job and AI service environment files reference that same value so callers and
the provider cannot silently drift to different credentials.

`GET /health` is a process liveness probe. `GET /ready` also verifies the
pgvector extension and both embedding tables, and returns 503 while storage is
unavailable. Docker Compose uses `/ready` for the AI Service health check.

The runtime image installs only `requirements.txt`. Heavy model providers live
in `requirements-ml.txt` and are intentionally deferred until the Kafka
embedding consumers or real chatbot are implemented; the on-demand `/match`
path does not need GPU/CUDA packages. The runtime process uses a non-root user
and applies Alembic migrations before starting Uvicorn.

## Tests

The isolated test Compose file builds the test stage, checks formatting/lint,
runs unit tests, migrates a disposable PostgreSQL 16 + pgvector database and
runs integration tests:

```bash
docker compose -f compose.test.yml up \
  --build --abort-on-container-exit --exit-code-from ai-tests
docker compose -f compose.test.yml down -v
```

The PostgreSQL suite verifies repeatable migration-at-head behavior, schema
privacy, vector dimensions, missing/model-mismatch results, cosine boundary
mapping and the HTTP contract against the real repository. The current suite
contains 37 unit tests and 12 PostgreSQL integration tests (49 total).

## Current boundary

`/match` intentionally reads precomputed vectors and never loads the embedding
model in a request. Until the idempotent `cv-events` and `job-events` consumers
are implemented, production requests normally return a not-ready reason unless
vectors have been seeded by an approved ingestion process.
