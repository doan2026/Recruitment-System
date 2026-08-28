# AI Service

FastAPI service for CV-to-job semantic matching and consent-scoped
recommendations. This vertical slice owns the pgvector schema, the internal
`POST /match` provider used by Application Service and the scoped
`POST /recommend/jobs` and `POST /recommend/candidates` providers used by Job
Search Service. Dedicated non-root
workers consume `job-events` and `cv-events`, generate pinned 384-dimensional
CPU embeddings and persist only vectors, hashes and filtering metadata.
Chatbot implementation remains a separate task.

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

Both vector columns are fixed at 384 dimensions. Job vectors retain a partial
HNSW cosine index for a future benchmarked ANN strategy; recommendation v1
forces an exact scan for complete, deterministic cursor pages. Only vectors,
hashes, model identity and minimal filtering metadata are stored; original
CV/job text is intentionally absent. The Candidate consent/authorization
contract now keeps v1 on an exact selected-CV allowlist; a CV nearest-neighbor
index remains deferred until that bounded filter/load profile is benchmarked.
Job salary filtering columns use
`NUMERIC(15,2)`, matching the Job source of truth.

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

## CV embedding worker

The dedicated `ai-cv-embedding-worker` consumes one pre-created `cv-events`
topic. The Kafka key is UUID text for `cv_id` and must parse to the same UUID as
the payload. Version 1 is an exact nine-field flat snake_case contract: missing
fields, extra fields, duplicate JSON keys and the old camelCase envelope are
rejected.

```json
{
  "event_id": "11111111-1111-4111-8111-111111111111",
  "action": "UPSERTED",
  "cv_id": "22222222-2222-4222-8222-222222222222",
  "candidate_id": "33333333-3333-4333-8333-333333333333",
  "file_id": "44444444-4444-4444-8444-444444444444",
  "cv_type": "UPLOAD",
  "occurred_at": "2026-08-28T01:02:03.000Z",
  "schema_version": 1,
  "aggregate_version": 7
}
```

`action` is exactly `UPSERTED`, `DEACTIVATED` or `DELETED`; `cv_type` is
exactly `UPLOAD` or `ONLINE`. All IDs are UUID strings, `occurred_at` is exactly
UTC millisecond `YYYY-MM-DDTHH:mm:ss.SSSZ`, and `aggregate_version` is a
positive PostgreSQL `BIGINT`. `cv_id` ownership is immutable: later events
cannot reassign an existing CV to another `candidate_id`. The minimal
`ai.cv_aggregate_owners` registry binds that UUID pair in the same transaction
as every upsert, terminal lifecycle event or parsed-source DLQ result and keeps
the binding after vector deletion; it stores no CV content or file metadata.

`UPSERTED` verifies `file_id` with Media using expected owner type `USER`, the
event's `candidate_id` and file type `CV`, then requests a short-lived signed
download URL. The internal key is sent only to Media's `/internal/verify` and
`/internal/download-url`; it is never forwarded to the signed host. Downloads
are HTTPS-only, redirect-free, restricted to the configured exact-host
allowlist, limited by expiry, declared/observed bytes, MIME and PDF magic, and
never use proxy environment variables. After Media has verified PDF metadata,
the download response MIME must be exactly `application/pdf` or Cloudinary's
private-download `application/octet-stream`, with exact byte count and `%PDF-`
magic. Only PDF is supported; DOC and DOCX are terminally rejected until a
separately bounded parser is designed.

PDF extraction runs in a disposable child process with wall-clock, page, text,
file-descriptor, CPU and best-effort memory limits. Parent/child IPC is bounded
UTF-8 JSON over `send_bytes`/`recv_bytes` and never unpickles child data. These
controls isolate parser failures and resource consumption; they are not a
malware sandbox. CV bytes and normalized text live only long enough to create
the embedding. Raw Kafka payloads, signed URLs, file bytes and CV text are never
stored or intentionally logged.

Lifecycle handling is atomic with the event ledger and aggregate cursor:

- `UPSERTED` writes or refreshes the vector and marks it active.
- `DEACTIVATED` retains the historical vector with `is_active = false` and is
  terminal for the immutable CV snapshot. Explicit Application `/match` calls
  by stored `cv_id` still use the retained vector.
- `DELETED` removes the vector and writes a permanent aggregate tombstone.

Neither delayed nor higher-version `UPSERTED` can reactivate a deactivated or
deleted CV. The worker checks the event ledger before any Media call, parse or
inference. Media 401/403/429/5xx responses, timeouts, malformed internal
envelopes and genuine parser process startup/IPC infrastructure failures are
retryable and do not advance the Kafka offset. Verified source
missing/inactive, PDF integrity failure and
corrupt/encrypted/blank/resource-killed/over-limit PDFs are terminal: the
repository atomically writes a hash-only DLQ row plus ledger result without
advancing the aggregate cursor, then the worker commits the offset. A later
`DELETED` can therefore progress. Unparseable events use the generic hash-only
transport DLQ. Automatic offset commit/store remains disabled.

After `alembic upgrade head`, run the worker directly with:

```bash
python -m app.cv_worker_main
```

For root Compose, configure the distinct `MEDIA_INTERNAL_API_KEY_AI` secret and
start `ai-cv-embedding-worker`; it waits for AI, Media and Kafka health. Roll
out the AI migration/API first, provision the topic and matching Media AI
credential, deploy the Profile producer/outbox, then start the worker. Events
may safely accumulate before it joins. Existing CV embedding rows migrate as
active, but no historical Profile event is synthesized; any baseline replay
must be explicitly reviewed before enabling the producer.

## Candidate-facing Job recommendations

`POST /recommend/jobs` is an internal v1 endpoint used only by
Job Search Service. It accepts a CV ID plus bounded `location`, `salary_min`
and `job_type` filters, and returns only Job IDs, normalized scores, an opaque
cursor and a stable empty-result reason. It never returns vectors, source text,
CV metadata or Job content.

The endpoint requires both `X-Internal-Service: job-search-service` and the
direction-scoped `X-Internal-Api-Key` configured as
`INTERNAL_API_KEY_JOB_SEARCH`. This key must be 32–512 printable ASCII bytes,
must differ from the legacy `/match` key, and should be rotated independently
with the Job Search caller. Missing and invalid credentials share the same 401
response.

Recommendations include only active target embeddings produced by the exact
same model as the active source CV. Ordering is deterministic by cosine
distance then UUID. Cursors are canonical base64url payloads signed with
HMAC-SHA256, are bound to endpoint, filters, source state and a transactional
target-set generation, and are capped at ten result pages. Any forged, reused
or stale cursor returns `RECOMMENDATION_CURSOR_STALE` without exposing which
part changed.

For pagination correctness, v1 forces an exact target scan only for the final
ranked vector query. Source lookup and generation checks still use normal
indexes. The generation triggers update in the same transaction as embedding
mutations; `/ready` verifies their rows, function, event shape and enabled
mode. The exact scan is intentionally correctness-first; query-load and
rate-limit benchmarks plus a filter-aware ANN strategy remain follow-up work
before raising limits.

## Recruiter-facing Candidate recommendation provider

`POST /recommend/candidates` is also internal-only. It receives one Job ID,
the exact authorized `job_version`, and a sorted, duplicate-free snapshot of
at most 500 Profile-authorized entries.
Each entry binds a Candidate to the exact active CV selected in the separate
Recruiter-discovery consent plus the current discovery/Profile versions. AI
ranks only those exact CV IDs; it never treats job-preference consent, a
default CV or every active CV as permission. The response contains only
Candidate IDs, normalized scores, an opaque cursor and a stable empty reason.
The Job embedding `source_version` must exactly equal the authorized Job
version; ingestion lag or stale/future embedding state fails closed.

The route uses the distinct
`INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES` credential. It cannot be called with
the `/match` or `/recommend/jobs` key. Its HMAC cursor is bound to the complete
Candidate/CV/version scope, authorized Job version, Job embedding state and
transactional CV target generation, so any Job, visibility, Profile or
selected-CV snapshot change makes a continuation stale. Target statistics and
ranking join every authorized `(candidate_id, cv_id)` pair exactly; a selected
CV ID can never authorize its actual owner under a mismatched Candidate ID.
Repository results outside the authorized Candidate set fail closed.

AI does not return Profile or CV data. Job Search must first authorize the
Recruiter, verified Company and active owned Job, then obtain the visibility
snapshot from Profile. After ranking it must synchronously revalidate the
returned entries with Profile before exposing its minimal card. This second
gate handles withdrawal races; there is no latest-Candidate fallback.

## Configuration

Copy `.env.example` to `.env` and set at least:

- `DATABASE_URL`
- `INTERNAL_API_KEY` — exactly the same secret as Application Service
- `INTERNAL_API_KEY_JOB_SEARCH` — distinct scoped Job Search-to-AI secret,
  32–512 printable ASCII bytes with no `replace-with` placeholder
- `INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES` — a second distinct scoped key for
  the consent-sensitive Candidate-ranking direction, with the same
  no-placeholder rule
- `DATABASE_CONNECT_TIMEOUT_SECONDS` (default 2)
- `DATABASE_STATEMENT_TIMEOUT_MS` (default 2000)
- `KAFKA_BROKERS`, the Job/CV topics, consumer groups and client IDs
- `KAFKA_MAX_ATTEMPTS` plus poll/retry/reconnect timing
- `EMBEDDING_MODEL_NAME`
- `EMBEDDING_MODEL_REVISION` — immutable model commit SHA
- `EMBEDDING_MODEL_CACHE` (default `/models`)
- `EMBEDDING_MODEL_LOCAL_FILES_ONLY`
- `EMBEDDING_DIMENSION` — must remain 384
- `MEDIA_SERVICE_URL`
- `MEDIA_INTERNAL_API_KEY` — distinct AI-to-Media key, at least 32 bytes
- `MEDIA_DOWNLOAD_ALLOWED_HOSTS` — comma-separated exact signed-host allowlist
- `MEDIA_REQUEST_TIMEOUT_SECONDS`, `MEDIA_DOWNLOAD_TIMEOUT_SECONDS`
- `MEDIA_MAXIMUM_FILE_BYTES` — hard maximum 5 MiB
- `MEDIA_MAXIMUM_URL_TTL_SECONDS` — hard maximum 600 seconds
- `CV_PDF_PARSER_TIMEOUT_SECONDS` — hard maximum 30 seconds
- `CV_PDF_MAXIMUM_PAGES` — hard maximum 100
- `CV_PDF_MAXIMUM_TEXT_CHARACTERS` — hard maximum 500,000

The API fails at startup if `DATABASE_URL`, `INTERNAL_API_KEY` or the distinct
`INTERNAL_API_KEY_JOB_SEARCH` is invalid. The worker independently validates
its database, Kafka, retry and pinned-model
configuration before loading the model or consuming events. Define
`INTERNAL_API_KEY` once in the repository root `.env`; the Application, Job and
AI service environment files reference that same value so callers and the
provider cannot silently drift to different credentials.

`GET /health` is a process liveness probe. `GET /ready` also verifies the
pgvector extension, both embedding tables, recommendation generation rows and
their enabled mutation triggers, and returns 503 while storage is unavailable.
Docker Compose uses `/ready` for the AI Service health check.

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
idempotency, retry/DLQ behavior, strict CV/Media/parser contracts, scoped auth,
signed/stale cursors, exact filtered pagination and transactional generation
triggers. Real Kafka tests cover publish → consume → pgvector, duplicate
delivery, source rejection followed by delete, hash-only malformed DLQ and
committed offsets. The current suite collects **319 unit/non-integration tests
and 51 PostgreSQL/Kafka integration tests (370 total)**. The production worker image
also successfully generated a normalized 384-dimensional vector with the
pinned model revision.

## Current boundary

`/match`, `/recommend/jobs` and `/recommend/candidates` read precomputed vectors
and never load the embedding model in a request. Job and CV embeddings are
populated asynchronously by their dedicated workers. Full
producer-to-Media-to-AI staging E2E, CV ANN/filter/load benchmarking,
distributed recommendation rate limiting and chatbot APIs remain outside this
service task.
