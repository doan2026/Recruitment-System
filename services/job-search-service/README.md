# Job & Search Service

B2-C01 establishes PostgreSQL as the source of truth for jobs. B2-C02 adds
the moderated publishing lifecycle.
Nginx strips the `/jobs` gateway prefix before forwarding requests.

| Internal | Gateway | Access |
| --- | --- | --- |
| `GET /health` | `GET /jobs/health` | Public |
| `POST /` | `POST /jobs/` | RECRUITER, VERIFIED company |
| `GET /mine` | `GET /jobs/mine` | RECRUITER |
| `GET /pending` | `GET /jobs/pending` | ADMIN |
| `GET /search` | `GET /jobs/search` | Public |
| `POST /reindex` | `POST /jobs/reindex` | ADMIN |
| `GET /reindex/failures` | `GET /jobs/reindex/failures` | ADMIN |
| `POST /reindex/failures/retry` | `POST /jobs/reindex/failures/retry` | ADMIN |
| `GET /stats/active?company_id=` | `GET /jobs/stats/active?company_id=` | Internal |
| `POST /details/bulk` | `POST /jobs/details/bulk` | Internal |
| `GET /:id/exists` | `GET /jobs/:id/exists` | Internal |
| `GET /:id` | `GET /jobs/:id` | Public, PUBLISHED only |
| `PUT /:id` | `PUT /jobs/:id` | OWNER or creating MEMBER |
| `PATCH /:id/publish` | `PATCH /jobs/:id/publish` | OWNER or creating MEMBER |
| `PATCH /:id/close` | `PATCH /jobs/:id/close` | OWNER or creating MEMBER |
| `PATCH /:id/approve` | `PATCH /jobs/:id/approve` | ADMIN |
| `PATCH /:id/reject` | `PATCH /jobs/:id/reject` | ADMIN |

Creating a job always stores `DRAFT`. Company membership and VERIFIED status
are resolved through `GET /companies/by-user/:userId` with the caller JWT.
OWNER manages every company job; MEMBER only manages jobs they created.

Salary is either negotiable (both bounds null) or a complete range where
`salaryMin <= salaryMax`. Deadline must be later than today. Editing critical
content on a PUBLISHED job moves it back to `PENDING_APPROVAL`. PostgreSQL and
the AI filtering projection both store salary as `NUMERIC(15,2)`; Kafka
serializes a present bound as a fixed two-decimal string to avoid JSON number
precision loss.

Lifecycle: `DRAFT -> PENDING_APPROVAL -> PUBLISHED -> CLOSED|EXPIRED`.
Admin rejection returns a pending job to `DRAFT` and stores the reason and
review metadata. The expiry worker runs at startup and then hourly (configurable
with `JOB_EXPIRY_INTERVAL_MS`) and expires published jobs whose deadline is
before the current UTC date.

Search accepts `q`, `location`, `salaryMin`, `salaryMax`, comma-separated
or repeated `skills`, `experienceYears`, `jobType`, `companyId`, `sort`,
`page`, and `limit` (maximum 50). Sort is `RELEVANCE`, `NEWEST`, or
`SALARY_DESC`. Results include total count, facets, and the data source used.
If Elasticsearch is unavailable or the index has not been created yet, the
request falls back to PostgreSQL. PostgreSQL facets describe the returned page;
Elasticsearch facets describe the complete filtered result set.
Search also stays on PostgreSQL while an Elasticsearch baseline is incomplete.
During that window `GET /health` reports `DEGRADED` with
`searchIndexReady=false`; after the durable baseline completes it reports
`UP` with `searchIndexReady=true` and search can use Elasticsearch.
The Elasticsearch request timeout defaults to two seconds and is configurable
with `ELASTICSEARCH_REQUEST_TIMEOUT_MS`.
`ELASTICSEARCH_INDEX` defaults to the new versioned index `job_index_v3`.
Never point this release at the legacy `job_index`: its strict mapping and
internal document versions are incompatible with the new projection contract.
At startup the service validates the strict mapping contract, all required
field types/analyzers/keyword multifields (including usable `index` and
`doc_values` settings), and the required `vietnamese_text` analyzer definition.
A configured alias is accepted only when it resolves to
one compatible concrete index; aliases with multiple targets are rejected.

Every event-producing mutation increments the Job's positive
`aggregate_version` and writes an immutable outbox row in the same PostgreSQL
transaction. A rollback therefore persists neither the Job change nor its
event. The outbox publisher is independent from BullMQ and Elasticsearch and
publishes the exact 16-field flat snake_case `job-events` v1 value below, using
the canonical `job_id` UUID as the Kafka key:

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

Delivery is at-least-once. `event_id` remains stable across retries so consumers
can deduplicate the rare duplicate produced when Kafka accepts a record before
PostgreSQL records `published_at`. The publisher blocks a later version of one
Job behind its earlier unpublished version, claims work with a database lease,
and renews that lease while Kafka is in flight. Each Kafka attempt has a finite
request timeout and retry limit; failure releases the row for a later outbox
attempt with capped exponential backoff.

Every Job mutation also upserts one durable index-sync intent in the same
PostgreSQL transaction as the Job and Kafka event outbox. After commit, a
leased dispatcher transfers that intent to BullMQ. The row stays pending until
the worker confirms Elasticsearch, so a Redis outage or lost queue state cannot
silently lose an index update.

Queue producer commands fail fast within `JOB_INDEX_REDIS_COMMAND_TIMEOUT_MS`
while the BullMQ worker keeps reconnecting; PostgreSQL retries dispatch when
Redis returns, and graceful shutdown does not wait forever on a cold outage.

The worker reads PostgreSQL as the source of truth. It writes complete documents
for current, non-expired `PUBLISHED` jobs and minimal non-searchable tombstones
for every other status. Each Elasticsearch document carries
`aggregateVersion` and `indexGeneration`. An atomic scripted update compares
that pair lexicographically, so an older generation of the same aggregate
version cannot overwrite a newer document or tombstone. Search explicitly
filters `searchable=true`.

BullMQ retries processing with exponential backoff. After its final attempt,
the same PostgreSQL sync row stores `failed_at`, a sanitized `last_error`, and
the attempt count as a durable dead letter. Admins can inspect failures through
`GET /jobs/reindex/failures` and replay them through
`POST /jobs/reindex/failures/retry`. BullMQ also retains a bounded failed-job
history for diagnostics. `POST /jobs/reindex` increments a dispatch generation
and reconciles every Job status idempotently; each page of at most 200 Jobs is
upserted with one set-based PostgreSQL statement instead of sequential writes.
The dispatcher stops claiming new rows as soon as graceful shutdown begins.
Both new and pre-existing compatible indices use persistent mapping metadata:
`_meta.baselineVersion` and `_meta.baselineIndexUuid`. If either marker is
missing, stale, or does not match the physical index UUID, startup queues a full
baseline and keeps search unready. A crash before completion leaves the marker
incomplete, so the next process restart safely resumes. The concrete index is
refreshed before the marker is written; the service then revalidates its name,
physical UUID, and marker before enabling Elasticsearch search. This makes the
baseline documents search-visible when completion succeeds and prevents a
replacement index from accepting a marker bound to the previous UUID. Alias or
index target changes still require the drain-and-restart procedure below.
Reindexing never synthesizes Kafka domain events.

The migrations intentionally do not invent historical Kafka events or index
intents. A populated environment must complete this release checklist:

1. Stop and drain every old Job Service instance so no legacy writer remains.
2. Apply the migration separately and configure the service with a new empty
   `ELASTICSEARCH_INDEX=job_index_v3`; do not reuse the legacy `job_index`.
   If this setting is an alias, stop and drain all instances before changing
   its target, then restart every instance so the new concrete index is
   resolved, fully validated, and baseline-gated.
3. Run an environment-specific historical Kafka/AI baseline or replay plan that
   has been reviewed for duplicate and ordering behavior. Elasticsearch v3 is
   baselined automatically by the service in the next step.
4. Start the new service. Its new-index bootstrap queues the Elasticsearch
   baseline automatically; calling `POST /jobs/reindex` remains a safe,
   idempotent reconciliation. Wait until every durable index-sync row is
   completed with no failed rows.
5. Verify the Elasticsearch and AI projection/version baselines before
   restoring normal traffic.
6. Retain the legacy index for the agreed rollback window, then remove it using
   the environment's reviewed retention procedure.

Published outbox-row retention cleanup is not automated yet; operators must plan
retention and cleanup separately.

Application Service checks `GET /jobs/:id/exists` before accepting a new
application. It must send `X-Internal-Api-Key` matching `INTERNAL_API_KEY`.
The response distinguishes a missing job, a non-published job, and a passed
deadline, and includes `companyId`, `recruiterId`, and `jobTitle` when the
job exists.

Application Service resolves bookmark lists through `POST /details/bulk` with
the same internal API key. The body contains `jobIds`, from one to 100 unique
UUIDs. The response preserves requested order for visible records, returns the
full public-safe Job detail projection, and reports the remaining identifiers
in `unavailableJobIds`. `PUBLISHED`, `CLOSED`, and `EXPIRED` Jobs stay visible
so an existing bookmark remains understandable; missing and moderation-only
statuses are unavailable and their private fields are not exposed. Every
returned item includes `acceptingApplications` and `availabilityReason`, so a
passed deadline or non-published lifecycle state is explicit.

Application Service reads the Recruiter Dashboard active-job total from
`GET /stats/active?company_id=<uuid>` using the same internal API key. The
count comes directly from PostgreSQL and includes only the company's
`PUBLISHED` jobs whose deadline is today or later in UTC, so it does not depend
on eventual Elasticsearch indexing.


```bash
npm install
npm run prisma:generate
npm test
npm run build
```

The verified local suite contains 57 unit tests. The isolated Docker gate
applies migrations to disposable PostgreSQL 16 and starts Kafka 3.8, authenticated
Redis 7, and Elasticsearch 8.14.3 with index auto-creation disabled. It runs
13 integration tests: one transaction/order/delivery outbox test, one
PostgreSQL bulk-detail contract test, and 11 indexing, search, ordering,
reindex, retry/dead-letter, outage, recovery, and restart tests:

```bash
docker compose -f compose.test.yml up \
  --build --abort-on-container-exit --exit-code-from job-tests
docker compose -f compose.test.yml down --volumes --remove-orphans
```

Swagger: `/docs` directly or `/jobs/docs` through the gateway.
