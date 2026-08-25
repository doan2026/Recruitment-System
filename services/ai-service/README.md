# AI Service

FastAPI service for CV-to-job semantic matching. This vertical slice owns the
pgvector schema and the internal `POST /match` provider used by Application
Service. A dedicated non-root worker now consumes `job-events`, generates pinned
384-dimensional CPU embeddings and persists only vectors, hashes and filtering
metadata. CV ingestion, recommendation and chatbot implementation remain
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

Alembic owns `ai.cv_embeddings`, `ai.job_embeddings`, the terminal event ledger,
aggregate cursor/tombstone state, sanitized dead-letter metadata and its version
table. The ledger and DLQ store hashes and Kafka metadata, never raw payloads,
CV text or job descriptions. Source event/version/timestamp provenance is kept
with each embedding.

Both vector columns are fixed at 384 dimensions. Job vectors have a partial
HNSW cosine index for the future recommendation query. Only vectors, hashes,
model identity and minimal filtering metadata are stored; original CV/job text
is intentionally absent. A CV nearest-neighbor index is intentionally deferred
until the recommend-candidates query and its filtering/load profile are
implemented. Job salary filtering columns use `NUMERIC(15,2)`, matching the Job
source of truth.

Run migrations from this directory:

```bash
alembic upgrade head
```

The container runs the same command before Uvicorn starts. PostgreSQL must use
the pgvector image/extension and `DATABASE_URL` must be a normal libpq URL,
without Prisma's unsupported `?schema=ai` query parameter.

## Job embedding worker

The Job producer uses Kafka key `job_id` and the exact 16-field flat snake_case
`job-events` v1 payload:

```json
{
  "event_id": "11111111-1111-4111-8111-111111111111",
  "action": "UPDATED",
  "job_id": "22222222-2222-4222-8222-222222222222",
  "company_id": "33333333-3333-4333-8333-333333333333",
  "title": "Backend Engineer",
  "description": "Build recruitment services",
  "skills": ["NestJS", "Kafka"],
  "location": "Ha Noi",
  "status": "PUBLISHED",
  "occurred_at": "2026-08-26T00:00:00.000Z",
  "schema_version": 1,
  "aggregate_version": 42,
  "requirements": "Three years of backend experience",
  "salary_min": "30000000.00",
  "salary_max": "50000000.00",
  "job_type": "FULL_TIME"
}
```

The consumer intentionally rejects the old camelCase envelope and any unknown
field. The producer now emits all 16 fields; salary bounds are fixed two-decimal
strings or null and fit the shared `NUMERIC(15,2)` range.

Only `PUBLISHED` jobs are active and embedded. `DRAFT`,
`PENDING_APPROVAL`, `CLOSED` and `EXPIRED` deactivate the stored vector,
and `/match` ignores inactive jobs. Delivery is at-least-once: the worker
disables automatic offset commit/store, commits synchronously only after a
durable terminal outcome, checks per-partition commit errors and reconnects
without advancing the offset on transient failures.

An event ledger prevents duplicate inference by `event_id`. The producer writes
the event and monotonic `aggregate_version` in the same PostgreSQL transaction,
then publishes from a leased outbox independently of BullMQ/Elasticsearch. The
producer renews its lease during Kafka I/O, uses finite Kafka request/retry
bounds, and retains failed rows for later backoff retries. The consumer's
aggregate cursor orders by `aggregate_version`; its legacy timestamp/partition/
offset fallback remains only for older records. Permanently invalid records are
dead-lettered with hashes, Kafka position and a stable error code only. Raw
keys, payloads and source text are never stored or logged.

The producer migration intentionally does not backfill historical outbox
events. A populated environment needs a reviewed baseline/replay before the new
producer is enabled. The Job service also does not yet automate retention
cleanup for published outbox rows.

The worker image pins
`sentence-transformers/all-MiniLM-L6-v2@1110a243fdf4706b3f48f1d95db1a4f5529b4d41`,
warms it before joining the consumer group and stores Hugging Face caches in
the `ai-model-cache` volume. The API image remains lightweight and never loads
the model during `/match`.

## Configuration

Copy `.env.example` to `.env` and set at least:

- `DATABASE_URL`
- `INTERNAL_API_KEY` — exactly the same secret as Application Service
- `DATABASE_CONNECT_TIMEOUT_SECONDS` (default 2)
- `DATABASE_STATEMENT_TIMEOUT_MS` (default 2000)
- `KAFKA_BROKERS`, `KAFKA_JOB_TOPIC`, consumer group and client ID
- `KAFKA_MAX_ATTEMPTS` plus poll/retry/reconnect timing
- `EMBEDDING_MODEL_NAME`
- `EMBEDDING_MODEL_REVISION` — immutable model commit SHA
- `EMBEDDING_MODEL_CACHE` (default `/models`)
- `EMBEDDING_MODEL_LOCAL_FILES_ONLY`
- `EMBEDDING_DIMENSION` — must remain 384

The API fails at startup if `DATABASE_URL` or `INTERNAL_API_KEY` is empty. The
worker independently validates its database, Kafka, retry and pinned-model
configuration before loading the model or consuming events. Define
`INTERNAL_API_KEY` once in the repository root `.env`; the Application, Job and
AI service environment files reference that same value so callers and the
provider cannot silently drift to different credentials.

`GET /health` is a process liveness probe. `GET /ready` also verifies the
pgvector extension and both embedding tables, and returns 503 while storage is
unavailable. Docker Compose uses `/ready` for the AI Service health check.

The API `runtime` image installs only `requirements.txt`. The dedicated
`worker` image installs the CPU-only dependencies in `requirements-ml.txt`;
chatbot-only dependencies remain separate in `requirements-chat.txt`. Neither
image requires CUDA. Both run as non-root users. The API applies Alembic
migrations before starting Uvicorn, and the root Compose worker waits for API
readiness before starting ingestion.

## Tests

The isolated test Compose file builds the test stage, checks formatting/lint,
runs unit tests, migrates a disposable PostgreSQL 16 + pgvector database and
runs integration tests:

```bash
docker compose -f compose.test.yml up \
  --build --abort-on-container-exit --exit-code-from ai-tests
docker compose -f compose.test.yml down -v
```

The full suite verifies migration-at-head behavior, privacy, vector dimensions,
inactive/missing/model-mismatch results, cosine boundaries, event ordering,
idempotency, retry/DLQ behavior and the HTTP contract. A real Kafka broker test
covers publish → consume → pgvector, duplicate delivery, hash-only malformed
DLQ and committed offsets. The current suite contains 159 unit tests and 29
PostgreSQL/Kafka integration tests (188 total). The production worker image also
successfully generated a normalized 384-dimensional vector with the pinned
model revision.

## Current boundary

`/match` intentionally reads precomputed vectors and never loads the embedding
model in a request. Job embeddings are now populated automatically from
`job-events`. CV ingestion remains pending because Profile Service does not yet
provide the canonical CV event/file contract, so end-to-end matching still
normally returns a missing-CV reason. Recommendation and chatbot APIs are also
outside this task.
