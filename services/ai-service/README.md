# AI Service

FastAPI service for CV-to-job semantic matching and consent-scoped
recommendations, plus a bounded Candidate-facing recruitment chatbot with an
optional personalized Job-suggestion intent. This vertical slice owns the
pgvector schema, the internal `POST /match` provider used by Application
Service, the scoped
`POST /recommend/jobs` and `POST /recommend/candidates` providers used by Job
Search Service, and the authenticated `POST /chat` API. Dedicated non-root
workers consume `job-events` and `cv-events`, generate pinned 384-dimensional
CPU embeddings and persist only vectors, hashes and filtering metadata.

## Candidate chatbot v1

Candidates call `POST /chat`; through the gateway the route is
`POST /ai/chat`. Chat is disabled by default and returns a sanitized 503 until
`CHAT_ENABLED=true` and all chat settings are valid. The route accepts a
canonical UUIDv4 `session_id` and one strictly bounded, normalized message. It
rejects extra fields, malformed/non-v4 session IDs, control characters,
oversized text and empty messages.

The route is Candidate-only. It verifies an RS256 access token against the
configured Auth JWKS, issuer and audience, requires a canonical user UUID and
the `CANDIDATE` role, and fails closed when keys are unavailable or claims are
invalid. JWT/JWKS failures, role failures and provider/storage failures expose
only stable, sanitized errors. Every `/chat` response, including failures,
sets `Cache-Control: no-store`, `Pragma: no-cache` and an appropriate
`Vary: Authorization` header.

The provider is Anthropic Claude Haiku, default model
`claude-haiku-4-5-20251001`, with a 15-second request timeout, at most 512
output tokens and no SDK retries. A transport-level monotonic deadline also
stops a response that keeps yielding below the per-read timeout from holding a
worker indefinitely. `ANTHROPIC_API_KEY` is loaded only from the service
environment; it is never accepted from a request, saved in chat history or
intentionally logged. A fixed system prompt treats both the user message and
prior history as untrusted, answers only recruitment questions, does not
disclose prompts or secrets, does not request passwords, OTPs or tokens, and
does not claim access to live account/application state.

Personalized Job suggestions are a separate rolling opt-in. When
`CHAT_RECOMMENDATION_TOOL_ENABLED=true`, Claude sees exactly one strict,
parameter-free `get_my_job_recommendations` intent tool. Its schema forbids
additional properties, parallel calls are disabled, and AI accepts only one
complete matching `tool_use` block. The model cannot supply a `user_id`,
`candidate_id`, `cv_id`, filters, cursor or endpoint. AI does not let Claude
call `/recommend/jobs`, `/recommend/candidates` or `/match`; instead it treats
the tool call only as an intent decision and makes one server-controlled GET to
the fixed Job Search `/recommended?limit=3` endpoint.

That direct endpoint must have the exact `/recommended` path on an allowlisted
host, with no userinfo, redirect, query configuration or fragment; AI adds only
the fixed `limit=3` query itself. Production requires HTTPS. The HTTP client
does not follow redirects or trust proxy environment variables and applies a
bounded 1–5 second network timeout plus a monotonic deadline across the
response stream. Job Search remains the authorization and fallback owner: it
derives the Candidate, active CV and saved preferences from the already
verified Candidate bearer rather than trusting model input.

The original Candidate bearer exists only for this in-flight server-to-server
request. It is never sent to Anthropic, written to Redis/chat history, included
in a Job card or intentionally logged. AI requests identity transfer encoding,
rejects compressed responses and caps the raw Job body at 256 KiB before JSON
parsing. The response must be no-store JSON with an exact envelope, rejects
duplicate keys and extra fields, and may contain at most three unique canonical
Job cards. AI projects each accepted card down to Job ID, title, company name,
location, type, salary, currency and optional reference score; descriptions,
skills, Company IDs, cursor and other wire fields are discarded.

Claude never formats the returned cards. A deterministic Vietnamese/English
formatter escapes Markdown and neutralizes URL-like text, labels any score as
reference similarity, caps its output and directs the Candidate to the
“Suitable Jobs” screen for current details. An empty snapshot has a stable
message. Job timeout, non-200 response or invalid envelope is fail-soft: chat
returns a deterministic temporary-unavailable answer instead of leaking the
downstream failure or failing the whole chat request. For both success and
fail-soft paths, Redis stores only a fixed neutral recommendation marker; Job
titles, companies, locations, scores and display answers never re-enter the
Claude conversation history.

Redis stores only bounded conversational state. HMAC-derived keys avoid raw
user/session identifiers in Redis key names, and every history, rate and lock
key is scoped to the authenticated owner. A session retains at most 10 turns
for 24 hours. Fenced locks serialize one request per owner/session; appending a
turn and refreshing its TTL is atomic, and an expired/replaced lock cannot
commit a stale answer. While a blocking provider/Job chain is in flight, a
dedicated bounded heartbeat renews only the exact current lock token; renewal
loss fails closed before the Job call or append, and the atomic append remains
the final fence. The service enforces an atomic sliding-window limit of 10
requests per user and 200 requests globally per 60 seconds. A 429 response
includes `Retry-After`; Redis failure fails closed rather than silently
bypassing rate limits or isolation.

The Redis client and Anthropic client are closed during application shutdown.
Session locks use exact-token renewal and release, plus a bounded TTL, so
provider errors, process loss and cancelled HTTP waiters do not leave an
unbounded resource.
After Candidate authentication, the blocking Redis, Claude and optional Job
orchestration runs in a dedicated bounded executor. A matching non-blocking
admission gate rejects excess work with sanitized `CHAT_BUSY`/503 and
`Retry-After` instead of building an unbounded queue. This keeps the long-lived
chat chain off FastAPI's normal worker capacity so an internal recommendation
request can complete when Job Search calls back into AI, preventing the
AI → Job → AI path from starving itself. Shutdown cancels queued work, drains
running chat workers without blocking the ASGI event loop, then closes the Job
client together with the other owned resources.

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

Both vector columns are fixed at 384 dimensions and retain partial active-row
HNSW cosine indexes. Job recommendation v1 forces an exact target scan for
complete cursor pages. Candidate recommendation first materializes the exact
authorized allowlist of at most 500 `(candidate_id, cv_id)` pairs, resolves
those rows through the CV primary/B-tree indexes, and only then calculates and
sorts exact cosine distances. A global HNSW scan is deliberately not used for
that dynamic allowlist because post-filtering can omit authorized nearest
neighbors and make stateless cursor pages incomplete. The CV HNSW is therefore
an advisory/future index with storage and ingestion cost, not a readiness
dependency or a production Candidate-ranking path. Only vectors, hashes, model
identity and minimal filtering metadata are stored; original CV/job text is
intentionally absent. Job salary filtering columns use `NUMERIC(15,2)`,
matching the Job source of truth.

Run migrations from this directory:

```bash
alembic upgrade head
```

The container runs the same command before Uvicorn starts. PostgreSQL must use
the pgvector image/extension and `DATABASE_URL` must be a normal libpq URL,
without Prisma's unsupported `?schema=ai` query parameter. Revision
`20260829_06` builds the CV HNSW with `CREATE INDEX CONCURRENTLY` and removes a
same-name invalid/leftover index before retrying. Production must run Alembic
through one migration job before rolling API replicas; multiple API startup
migrators must not race on this index.

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
mode. For this Candidate-facing `/recommend/jobs` direction, the full-target
exact scan is intentionally correctness-first. The controlled gate below now
covers HTTP correctness, concurrent-writer cursor behavior and local query load
at 100,000 targets. Distributed rate limiting is now available for both
surfaces; deployed/multi-replica capacity and real-model relevance remain
follow-up work before raising limits. Filter-aware ANN was investigated and
ruled out for this surface — see below. This work is separate from the bounded
`/recommend/candidates` allowlist gate below.

## Why filter-aware ANN stays off for Job recommendation

pgvector 0.8 ships an iterative index scan that resumes an HNSW search until a
filtered result set is satisfied, with `strict_order` preserving exact distance
order. That is the shape of the long-standing "filter-aware ANN" follow-up, so
it was investigated directly against the real schema. It cannot be adopted for
this surface, and `tests/integration/test_job_ann_filter_aware_postgres.py`
keeps that conclusion executable rather than folklore.

The blocker is not the index and not the filters:

- the partial active-row HNSW index serves a pure `ORDER BY vector <=> const`
  ordering, and keeps serving it with the Job filters applied, so a
  filter-aware scan would be reachable if the ordering allowed it;
- the production query scores inside a CTE and orders the outer result, which
  detaches the ordering from the scan and puts any vector index out of reach —
  so a GUC alone changes nothing;
- flattening the query is not enough either. The index serves the distance key
  alone; adding the deterministic `job_id` tie-break makes it unusable, because
  an ordering operator cannot be combined with an ordinary sort key.

That tie-break is exactly what the stateless HMAC keyset cursor depends on:
distance alone is not a total order, so two Jobs at the same cosine distance
would let a continuation revisit or skip rows. Adopting ANN here therefore
means giving up complete, reproducible cursor pages, which is a pagination
contract change and not a tuning flag. The full-target exact scan stays until
that contract is redesigned.

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

The controlled 100,000-CV gate confirms that production exact plans for scopes
1/100/500 use the CV primary/B-tree indexes, never a CV sequential scan or
HNSW, and traverse 1/2/10 pages with zero mismatch, duplicate or privacy leak.
An intentionally forced advisory HNSW experiment reached recall@100 `1.0`, but
global top-500 followed by the dynamic 500-CV allowlist found none of that
allowlist's exact top 50. Enabling that plan would therefore trade away result
completeness even when global ANN recall looks perfect.

AI does not return Profile or CV data. Job Search must first authorize the
Recruiter, verified Company and active owned Job, then obtain the visibility
snapshot from Profile. After ranking it must synchronously revalidate the
returned entries with Profile before exposing its minimal card. This second
gate handles withdrawal races; there is no latest-Candidate fallback.

## Distributed recommendation rate limits

Both recommendation surfaces are internal and already authenticate the calling
service, so the limiter is not an anti-abuse gate against unauthenticated
traffic. It bounds how much shared pgvector work one subject can cause: a
single CV looping `/recommend/jobs` or a single Job looping
`/recommend/candidates` — through a retry storm, a stuck client, or an abusive
Candidate driving Job Search — cannot monopolise capacity for everyone else.

Counting lives in Redis rather than in process memory precisely because the
service runs several replicas. A per-process limiter would multiply the real
budget by the replica count and drift whenever replicas scale, so it could not
express a system-wide budget at all.

Each surface keeps its own subject budget and its own global budget, so a burst
on one surface cannot starve the other. The subject is the `cv_id` for
`/recommend/jobs` and the `job_id` for `/recommend/candidates`.

A single Lua script performs the window trim, both limit checks and the write,
using Redis server `TIME` as the only clock. Replicas with skewed system clocks
therefore share one window, and two replicas cannot both observe the last free
slot and take it. Keys carry HMAC-SHA256 digests derived from a dedicated
secret, never a raw `cv_id` or `job_id`, so Redis holds nothing that links a
subject to its recommendation traffic; counters expire one second past the
window, so idle subjects leave no residue. Both keys of one surface share a
hash tag, keeping the script single-slot on a Redis Cluster.

The limiter is opt-in. With `RECOMMENDATION_RATE_LIMIT_ENABLED` unset, the
endpoints behave exactly as before and take no Redis dependency. When it is
enabled the limiter fails **closed**: an unreachable Redis or an unexpected
script result returns a sanitized `503 RECOMMENDATION_LIMIT_UNAVAILABLE`
rather than silently letting every replica run unbounded exactly when the
dependency is already unhealthy. An exhausted budget returns `429
RECOMMENDATION_RATE_LIMITED` with `Retry-After`, charged before any
vector-store work happens. Scoped authorization and payload validation both run
before the charge, so an unauthenticated or malformed caller can never drain
another subject's budget.

## Vietnamese relevance gate

Every embedding test elsewhere uses synthetic vectors, which proves the
plumbing and the arithmetic but says nothing about whether the pinned model
separates Vietnamese recruitment text. This gate loads the exact pinned model
revision the worker ships and ranks a curated Vietnamese corpus with it — four
domains (backend, frontend, kế toán, nhân sự), two Jobs and one CV each.

```bash
docker build --target worker -t ai-service:relevance-gate .
docker run --rm --network none \
  -v recruitment-system_ai-model-cache:/models \
  -e PYTHONPATH=/app -w /app \
  ai-service:relevance-gate python scripts/vietnamese_relevance_gate.py
```

It runs with no network and `local_files_only`, so it measures the pinned
revision rather than whatever a download would fetch today.

Measured on that revision:

| Metric | Value | Treated as |
| --- | --- | --- |
| precision@1 | `1.0` | hard requirement |
| accentless agreement | `1.0` | hard requirement |
| clean separation rate | `0.25` | recorded baseline |

The first two are properties the model does hold on Vietnamese: every CV ranks
a Job from its own domain first, and stripping diacritics does not change the
top domain. Those must keep holding.

Clean separation — both same-domain Jobs ahead of every other domain — is where
the pinned model falls short: it reliably ranks only the single closest
same-domain Job first, and the second one often sits below a cross-domain Job.
That is a model property, not a bug in the ranking code, so the gate records
`0.25` and fails on a regression below it rather than demanding a number this
model never reached. Raising it means adopting a Vietnamese-capable embedding
model, which is a separate decision.

This is a controlled probe on a small hand-written corpus, not a production
relevance benchmark. It is the first real-model Vietnamese evidence the service
has; it does not by itself justify raising recommendation limits.

## Live provider FAQ smoke

Everything about the chatbot is covered offline with a deterministic provider.
The one thing offline tests structurally cannot answer is whether the real
model, behind the real fixed prompt, produces usable recruitment answers and
holds the prompt's safety line. That needs a real credential, so it is a
guarded runner rather than a test:

```bash
AI_CHAT_LIVE_SMOKE_CONFIRM=run-live-claude-faq-smoke \
ANTHROPIC_API_KEY=<real provider key> \
  python scripts/chat_faq_live_smoke.py
```

It refuses to run without that exact confirmation value and without a
well-formed provider key, so it cannot spend quota by accident or in CI. It
asks the same ten canonical FAQs the offline suite routes through the bounded
provider, then four safety probes the fixed prompt promises to refuse: prompt
disclosure, a credential request, another user's data, and an off-topic
override.

The report is counts, latencies and per-question verdicts only. It never prints
the API key and never prints an answer — a failing question is reported by
index and rule name, so even a failed run cannot leak what the model said. A
refusal is allowed to name a credential in order to decline it; only an answer
that reads like it is handing one over fails.

`tests/unit/test_chat_faq_live_smoke.py` covers the parts that need no
credential: the opt-in gate, key validation and redaction, the quality rules,
provider-outage handling, and that questions are asked with no history and no
tool so the probe measures the prompt alone.

Running this with a real key remains an operator step. Until it is run, the
live quality claim stays open regardless of how green the offline suite is.

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
- `CHAT_ENABLED` — defaults to `false`; enable only after the remaining chat
  settings and staging provider credential are provisioned
- `REDIS_URL` — dedicated Redis connection used for chat history, rate limits
  and fenced session locks
- `CHAT_REDIS_KEY_SECRET` — distinct secret used to HMAC owner/session Redis
  keys; do not reuse an internal API key
- `ANTHROPIC_API_KEY` — provider credential supplied only through the service
  environment
- `ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`)
- `CHAT_PROVIDER_TIMEOUT_SECONDS` (default 15)
- `CHAT_MAX_OUTPUT_TOKENS` (default 512)
- `CHAT_HISTORY_TTL_SECONDS` (default 86,400)
- `CHAT_HISTORY_MAX_TURNS` (default 10)
- `CHAT_RATE_WINDOW_SECONDS` (default 60)
- `CHAT_USER_RATE_LIMIT` (default 10)
- `CHAT_GLOBAL_RATE_LIMIT` (default 200)
- `CHAT_SESSION_LOCK_SECONDS` (default 30)
- `CHAT_MAX_CONCURRENT_REQUESTS` — dedicated chat executor/admission capacity;
  default 8, bounded to 1–32
- `CHAT_RECOMMENDATION_TOOL_ENABLED` — defaults to `false`; controls whether
  the parameter-free personalized recommendation intent is exposed to Claude
- `CHAT_JOB_RECOMMENDATION_URL` — fixed direct Job Search URL whose path must be
  exactly `/recommended`; AI supplies the fixed `limit=3` query
- `CHAT_JOB_SERVICE_ALLOWED_HOSTS` — exact hostname allowlist for that direct
  Job call
- `CHAT_JOB_SERVICE_ALLOW_INSECURE_HTTP` — development Compose only; production
  service-to-service traffic must remain HTTPS
- `CHAT_JOB_REQUEST_TIMEOUT_SECONDS` — default 3, bounded to 1–5 seconds
- `RECOMMENDATION_RATE_LIMIT_ENABLED` — defaults to `false`; when enabled it
  requires `REDIS_URL` and makes the recommendation surfaces fail closed on a
  Redis outage
- `RECOMMENDATION_REDIS_KEY_SECRET` — 32–512 printable ASCII bytes; must differ
  from `CHAT_REDIS_KEY_SECRET` so the two key spaces stay independent
- `RECOMMENDATION_RATE_WINDOW_SECONDS` (default 60, bounded 10–3,600)
- `RECOMMENDATION_SUBJECT_RATE_LIMIT` — per `cv_id`/`job_id` budget per window;
  default 30, bounded 1–1,000
- `RECOMMENDATION_GLOBAL_RATE_LIMIT` — per-surface budget per window; default
  600, must not be below the subject limit
- `JWT_ISSUER`, `JWT_AUDIENCE` and `JWT_JWKS_URI` — Auth access-token
  verification settings
- `JWT_JWKS_ALLOWED_HOSTS` — exact allowlist for JWKS retrieval
- `JWT_ALLOW_INSECURE_JWKS` — development-only opt-in for the internal HTTP
  Auth URL; leave disabled for HTTPS deployments
- `JWT_JWKS_TIMEOUT_SECONDS` (default 3)
- `JWT_JWKS_CACHE_TTL_SECONDS` (default 300)

The API fails at startup if `DATABASE_URL`, `INTERNAL_API_KEY` or the distinct
`INTERNAL_API_KEY_JOB_SEARCH` is invalid. When chat is enabled, it additionally
validates the Redis URL, HMAC secret, Anthropic key/model, rate/retention bounds
and JWT/JWKS trust settings before serving requests. Enabling the recommendation
tool additionally requires its exact endpoint and host allowlist. The session
lock TTL must cover the Claude timeout, a five-second safety margin and, while
the tool is enabled, the Job timeout. The worker independently validates its
database, Kafka, retry and pinned-model configuration before loading the model
or consuming events. Define
`INTERNAL_API_KEY` once in the repository root `.env`; the Application, Job and
AI service environment files reference that same value so callers and the
provider cannot silently drift to different credentials.

Roll out the personalized tool independently from chat: deploy with
`CHAT_RECOMMENDATION_TOOL_ENABLED=false`, provision the production HTTPS URL
and exact Job hostname, verify the fixed endpoint and callback capacity in
staging, then enable the flag on a small AI canary before widening it. Watch
chat admission rejections, Job timeouts/fail-soft answers and AI recommendation
capacity. Rolling back only this feature requires setting the recommendation
flag to `false`; ordinary recruitment chat remains available while Claude no
longer receives the tool definition.

`GET /health` is a process liveness probe. `GET /ready` also verifies the
pgvector extension, both embedding tables, recommendation generation rows and
their enabled mutation triggers, and returns 503 while storage is unavailable.
Docker Compose uses `/ready` for the AI Service health check.

The API `runtime` image installs `requirements-chat.txt`, which extends the
base requirements with the pinned Anthropic SDK, `PyJWT[crypto]` and Redis
client. The dedicated `worker` image remains lean and installs only the
CPU-specific dependencies in `requirements-ml.txt`; it does not inherit the
chat/JWT/Redis stack. Neither image requires CUDA. Both run as non-root users.
The API applies Alembic migrations before starting Uvicorn, and the root
Compose worker waits for API readiness before starting ingestion.

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
triggers. Chat tests cover strict request parsing, Candidate-only RS256/JWKS
authentication, fixed-prompt construction, sanitized provider failures,
owner/session isolation, HMAC PII-free Redis keys, atomic rate limiting,
history trimming/expiry, lock fencing and shutdown/error-path cleanup. The
personalized-tool tests cover the strict parameter-free intent, fixed-origin
Job request, transient bearer handling, bounded three-card projection,
deterministic formatting, neutral provider-history marker, fail-soft behavior,
raw-body/total-deadline bounds, renewable fencing and dedicated executor
admission/lifecycle.
Real Redis integration tests exercise the state scripts; provider tests use a
deterministic fake and do not claim live Claude answer quality. Real Kafka tests
cover publish → consume → pgvector, duplicate delivery, source rejection
followed by delete, hash-only malformed DLQ and committed offsets. The final
isolated Docker gate passed **529 unit/non-integration tests and 62
PostgreSQL/Kafka/Redis integration tests (591 total)**. This count is not a
live-Claude or deployed AI → Job → AI E2E claim.
The production worker image also successfully generated a normalized
384-dimensional vector with the pinned model revision.

Run the isolated Candidate index/filter/repository load gate separately:

```bash
./scripts/verify-candidate-recommendation-benchmark.sh
```

The guarded runner refuses external database/Docker targets, uses digest-pinned
Python and PostgreSQL/pgvector images, opens no host port and cleans only its
run-labelled resources. Its deterministic fixture contains 80,000 active
same-model, 10,000 inactive same-model and 10,000 active wrong-model CVs.
Revision `20260829_06` upgraded the populated 100,000-row database in
`5,284.159 ms`; the valid/ready HNSW occupied `184,328,192` bytes. The
repository gate then completed 10,000 calls at concurrency 32 with zero errors
or source mismatch: `323.129` requests/second, p95 `130.089 ms`, p99
`149.503 ms`, and maximum `183.722 ms` under the production 2-second statement
timeout. These are controlled local PostgreSQL/repository results using
synthetic 2D-in-384 vectors; they are not an HTTP, deployed, real-model
Vietnamese relevance or production SLO claim. The populated migration run did
not measure a simultaneous writer.

### Candidate-facing Job full-target HTTP/load gate

Run the guarded standalone gate separately:

```bash
./scripts/verify-job-recommendation-benchmark.sh
```

The runner starts the actual FastAPI `POST /recommend/jobs` route against
100,000 Job embeddings: 80,000 active same-model, 10,000 inactive same-model
and 10,000 active wrong-model rows, plus one active source CV. It verifies an
independent float32-cosine oracle for unfiltered, location, salary and job-type
queries; 1/2/10-page cursor walks; UUID tie ordering; inactive/model isolation;
scoped authentication, strict validation and redaction;
committed/rolled-back/zero-row generation behavior; concurrent readers and
writers; and EXPLAIN evidence for the intentional full-target sequential scan
without Job HNSW.

The default run completed 100 warm-up plus 1,000 measured HTTP calls at
concurrency 8 with zero errors, oracle mismatches, timeouts or security leaks:
`10.762` requests/second, p95 `1,021.163 ms`, p99 `1,133.728 ms` and maximum
`1,299.623 ms` under the production 2-second database statement timeout.
Concurrent continuations returned only an exact HTTP 200 page or canonical
stale-cursor HTTP 409.

This is a controlled local Docker gate using synthetic 2D-in-384 vectors and
one API/PostgreSQL pair. It is not a real-model Vietnamese relevance,
deployed/multi-replica capacity, gateway, production SLO, filter-aware ANN or
distributed rate-limit claim.

## Current boundary

`/match`, `/recommend/jobs` and `/recommend/candidates` read precomputed vectors
and never load the embedding model in a request. Job and CV embeddings are
populated asynchronously by their dedicated workers. `/chat` is a separate,
Candidate-only Claude request path and does not expose those vector APIs as
model tools. With its independent feature flag enabled, a strict intent may
call only Job Search's fixed `/recommended` endpoint; Job Search owns Candidate
authorization, CV/preference resolution and any existing call back to AI's
internal recommendation provider. The contract, authorization, bounded
executor, Redis controls, strict projection, deterministic formatter and
fail-soft paths are covered deterministically. A guarded live-Claude 10-FAQ
quality smoke and deployed AI → Job → AI staging E2E remain pending until the
required staging credentials and environment are available; fake-provider and
mock-downstream results are not live quality or E2E claims.
Full producer-to-Media-to-AI staging E2E, deployed/multi-replica recommendation
load, real-model Vietnamese relevance, concurrent-writer rollout observation
on real environments, production monitoring/SLO, filter-aware ANN and
distributed recommendation rate limiting remain outside the completed service
slices.
