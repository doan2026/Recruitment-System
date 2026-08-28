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
| `GET /recommended` | `GET /jobs/recommended` | CANDIDATE |
| `GET /:jobId/recommended-candidates` | `GET /jobs/:jobId/recommended-candidates` | RECRUITER, manageable active Job |
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
`page`, `pagination`, `cursor`, and `limit` (maximum 50). Sort is `RELEVANCE`,
`NEWEST`, or `SALARY_DESC`. OFFSET pages and the first CURSOR page include the
exact total count and facets, plus the data source used, `hasMore`, and nullable
`nextCursor`. CURSOR continuations preserve the signed first-page total and
return empty facet maps instead of recomputing totals and aggregations on every
deep page; clients should retain the facets from the first page.

`pagination=OFFSET` is the backward-compatible default. It uses `page` and
`limit`, does not allocate an Elasticsearch point-in-time snapshot, and rejects
requests beyond the 10,000-result window. `hasMore` can be true while
`nextCursor` is null in this mode. Clients that need a stable or deep traversal
must send `pagination=CURSOR` from the first page, keep `page=1`, then repeat
the exact pagination mode, filters, sort, and limit with each returned cursor.
CURSOR mode uses PIT plus `search_after`, deterministic Job-ID and shard
tie-breakers, and never falls back to a different data source mid-traversal.
The opaque cursor input is limited to 4096 UTF-8 characters.
The signed cursor expires at a fixed time five minutes after the first page;
following it does not extend that absolute deadline. Expired cursors return
`409 JOB_SEARCH_CURSOR_STALE`; malformed/tampered or scope-mismatched cursors
return `400`; a temporarily unavailable continuation returns `503`.

`JOB_SEARCH_CURSOR_HMAC_KEY` is mandatory at startup and must be a distinct,
non-placeholder secret of at least 32 UTF-8 bytes. Rotate it only with a
drain/restart plan because rotation deliberately invalidates outstanding
cursors. The PIT idle lifetime is bounded by the same absolute five-minute
cursor expiry. `JOB_SEARCH_MAX_OPEN_PITS` (default 64, maximum 1024) caps PITs
opened by one service process, including requests clients abandon; new CURSOR
starts receive `429 JOB_SEARCH_CURSOR_CAPACITY` at the cap while existing
continuations can finish. Size the aggregate cap across all replicas against
the Elasticsearch cluster and alert on search open-context usage. Search
responses use `Cache-Control: no-store` and `Pragma: no-cache`. Elasticsearch
timed-out, failed-shard, and otherwise incomplete results are rejected rather
than exposed as a complete page.

Keyword relevance requires every normalized term and uses bounded Elasticsearch
fuzziness (`AUTO`, prefix length 1, maximum 25 expansions). This keeps typo
tolerance while preventing a broad OR query from dominating latency or returning
documents that match only one term.

If Elasticsearch is unavailable or the index has not been created yet, the
OFFSET requests fall back to PostgreSQL. PostgreSQL facets describe the returned
page;
Elasticsearch facets describe the complete filtered result set.
Search also stays on PostgreSQL while an Elasticsearch baseline is incomplete.
During that window `GET /health` reports `DEGRADED` with
`searchIndexReady=false`; after the durable baseline completes it reports
`UP` with `searchIndexReady=true` and search can use Elasticsearch.
The Elasticsearch request timeout defaults to two seconds and is configurable
with `ELASTICSEARCH_REQUEST_TIMEOUT_MS`.
`ELASTICSEARCH_INDEX` defaults to the new versioned index `job_index_v4`.
Never point this release at the legacy `job_index`: its strict mapping and
internal document versions are incompatible with the new projection contract.
At startup the service validates the strict mapping contract, all required
field types/analyzers/keyword multifields (including usable `index` and
`doc_values` settings), and the exact `vietnamese_text` analyzer definition.
That analyzer removes every Unicode combining mark with a `pattern_replace`
character filter before standard tokenization, then applies `lowercase` and
`asciifolding`. NFC, NFD, and accentless Vietnamese therefore produce the same
tokens; a missing, changed, or extended analyzer/character-filter contract is
rejected before indexing starts.
A configured alias is accepted only when it resolves to
one compatible concrete index; aliases with multiple targets are rejected.

## Candidate job recommendations

`GET /recommended` is Candidate-only and derives the Candidate identity from
the verified JWT. It never accepts a `userId` or `cvId`. The request supports
`limit` (1–50, default 10), an opaque cursor of at most 1024 UTF-8 bytes, and
optional `location`, `salaryMin`, and `jobType` filters. Location is
canonicalized with NFKC, Unicode whitespace is collapsed, and control
characters plus `%`, `_`, and `\\` are rejected so the PostgreSQL
case-insensitive filter remains literal rather than treating user input as an
ILIKE pattern or escape sequence.

The service forwards the Candidate bearer token only to Profile. It first calls
`GET /cvs`, selects the active default Media-backed CV (or the deterministic
newest legacy CV), and calls AI `POST /recommend/jobs` with only the scoped
`AI_INTERNAL_API_KEY`. Profile `GET /job-preferences` is read only when a first
page must fall back; a successful AI page and every continuation page never
read preferences. All outbound calls reject redirects, use bounded timeouts
and response bodies, and never retry. The configured URL must have a root path
and its normalized hostname must appear in the corresponding
`*_SERVICE_ALLOWED_HOSTS` list. Deployments using custom DNS names must add
those names explicitly; this allowlist prevents a bad URL from sending the
Candidate JWT or scoped AI credential to an untrusted host.

PostgreSQL remains authoritative. One query revalidates AI identifiers against
`PUBLISHED` status, the UTC deadline, location, salary, and job type, selecting
only public job-card columns and restoring AI order. On the first page only,
Profile/AI unavailability, AI not-ready states, or fully stale results resolve
the Candidate's explicit Profile preferences before using latest jobs. Only an
`ENABLED` consent projection is usable; `UNSET`, `DISABLED`, malformed,
unavailable, contradictory, or empty projections fail closed to `LATEST`.
Profile headline, skills, CV metadata, and CV content are never inferred as
preferences.

Request `location`, `salaryMin`, and `jobType` values remain hard filters and
override the same stored preference dimension. Target roles always remain an
active preference. Remaining criteria use ANY semantics: target role and
location are exact case-insensitive matches, job type is exact, and minimum
salary matches either a negotiable job or a VND job whose maximum salary meets
the canonical decimal threshold. Matching jobs are ordered by
`publishedAt DESC NULLS LAST, id ASC`; the page is filled with latest eligible
jobs excluding IDs already selected. Both reads share one Repeatable Read
snapshot. At least one preference match yields `source=PREFERENCES`; no match
yields `source=LATEST`. Non-AI items have `score=null`, every fallback has
`nextCursor=null`, and the original AI/Profile `fallbackReason` is preserved.
The response is marked `private, no-store` with `Vary: Authorization`.

A continuation request never mixes an AI page with a preference/latest
fallback and does not read Profile preferences. A missing CV, an AI
cursor-stale response, empty AI page, or a page whose identifiers are all stale
returns HTTP 409
`RECOMMENDATION_CURSOR_STALE`. Profile/AI timeout, malformed response, or 5xx
returns HTTP 503 `RECOMMENDATION_UNAVAILABLE`.

`AI_INTERNAL_API_KEY` must contain 32–512 printable ASCII characters
(`0x21`–`0x7e`), excluding spaces and all control/Unicode characters. A
missing or unsafe key is never sent. First-page requests
stay on `LATEST`, while `GET /health` reports
`recommendationConfigured=false` and `DEGRADED`. This field reports local
configuration only; it is not an upstream AI availability probe. Profile and
AI URLs, allowed hosts, and timeouts are validated at startup.
`candidateRecommendationConfigured` is true only when the Profile and distinct
Candidate-ranking AI keys are safe and Company recommendation URL, allowlist
and timeout configuration is valid. An invalid local value makes `/health`
`DEGRADED`; health never calls Company, Profile or AI.

## Recruiter Candidate recommendations

`GET /:jobId/recommended-candidates` is Recruiter-only and accepts only a
bounded `limit` (1–50, default 10) plus an opaque cursor of at most 1024 UTF-8
bytes. Recruiter, company, Candidate and CV identities cannot be supplied in
the query. The Recruiter identity comes from the verified JWT.

Before calling a Candidate-data dependency, Job Service resolves the caller's
strict self-membership projection from Company Service. The company must still
be `VERIFIED`; the Job must belong to it, remain `PUBLISHED`, and have a UTC
deadline of today or later. An `OWNER` can use any company Job while a `MEMBER`
can use only a Job they created. After downstream resolution, Job Service
re-fetches the caller's strict self-membership with the same bearer. Company,
verification status and membership role must be unchanged, and the current
role must still permit the Job. Only then is the exact Job aggregate version,
lifecycle and deadline revalidated with a fresh UTC clock before a response is
returned.

Job Service requests the purpose-scoped Profile discovery snapshot with the
distinct `PROFILE_INTERNAL_API_KEY`. The snapshot contains at most 500 sorted
Candidate/CV/version tuples and no Profile content. An empty first-page
snapshot returns `NO_DISCOVERABLE_CANDIDATES` without calling AI; the same
condition on a continuation returns HTTP 409 `RECOMMENDATION_CURSOR_STALE`.
Otherwise Job calls internal AI `POST /recommend/candidates` using the distinct
`AI_CANDIDATE_INTERNAL_API_KEY`; it sends the canonical Job ID, positive
`job_version` aggregate version, exact eligible scope, limit and cursor. The
version binds ranking and pagination to the Job snapshot that was authorized.
Neither internal call receives the Recruiter bearer token.

Every AI result is resolved again through Profile with the exact Candidate,
CV, discovery-version and Profile-version tuple from the snapshot. A withdrawn,
deleted or version-mismatched Candidate is omitted by Profile and causes the
public request to fail closed with HTTP 409. Dependency timeouts, malformed
contracts and non-cursor failures return 503. There is no newest-Candidate or
unconsented fallback.

The public response contains only `jobId`, Candidate `candidateId`, `fullName`,
nullable `headline`, deterministic self-declared skill names, AI score, cursor
and a stable empty reason. It never contains CV IDs or versions, contact data,
download URLs, vectors or source content. Responses use `private, no-store`,
`Pragma: no-cache` and `Vary: Authorization`. The score is semantic similarity,
not evidence of qualification and must not be used for automatic rejection.

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

`JOB_EVENT_PUBLISHER_ENABLED` defaults to `true`. Set it to the exact value
`false` during a controlled rollout to pause polling and Kafka delivery while
normal Job mutations and the historical baseline continue appending durable
outbox rows. Any other non-empty value fails startup. Re-enable the publisher
on a separately deployed normal service instance only after the AI consumer
and baseline have been verified.

## Controlled historical Job event baseline

The one-shot command appends snapshots for Jobs created before the
transactional producer was deployed. It does not expose an HTTP route, start
the expiry/index dispatchers, connect to Kafka, or publish events. Build once,
then inspect counts with the default dry-run:

```bash
npm run build
npm run baseline:job-events
```

Execution is fail-closed and requires the exact confirmation token:

```bash
npm run baseline:job-events -- \
  --execute \
  --confirm JOB_EVENTS_BASELINE_V1 \
  --batch-size 100 \
  --max-batches 1
```

`--batch-size` is limited to 1–500 and `--max-batches` to 1–10,000; one
batch is the safe default. Output is JSON counts only. Exit code `2` means
rows remain or a `PUBLISHED` Job has a deadline before the current UTC date.
In the latter case execute mode writes nothing: run the normal expiry process
first, then repeat the dry-run.

Progress is the durable anti-join between each Job's current
`aggregate_version` and the unique outbox key. Every transaction rescans from
the beginning, locks one missing batch with `FOR UPDATE SKIP LOCKED`, and
appends without changing the Job version or `updated_at`. Repeated and
concurrent runs are therefore safe. `DRAFT`, `PENDING_APPROVAL`, and
`PUBLISHED` snapshots use `UPDATED`; `CLOSED` uses `CLOSED`; `EXPIRED` uses
`EXPIRED`. All statuses are included so downstream consumers receive the
current source-of-truth state. This command is not a general Elasticsearch
reindex or AI model rebuild.

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
   `ELASTICSEARCH_INDEX=job_index_v4`; do not reuse `job_index_v3` or the
   legacy `job_index`, because analyzer settings cannot be changed in place.
   If this setting is an alias, stop and drain all instances before changing
   its target, then restart every instance so the new concrete index is
   resolved, fully validated, and baseline-gated.
3. Deploy the new writer with `JOB_EVENT_PUBLISHER_ENABLED=false`. New
   mutations remain transactional and accumulate in the outbox, but nothing
   is sent to Kafka yet.
4. Deploy and verify the strict AI consumer. Run the Job event baseline dry-run,
   then execute bounded batches until the command exits `0`. The CLI only
   appends outbox snapshots; do not expect it to drain Kafka itself.
5. Enable `JOB_EVENT_PUBLISHER_ENABLED=true` on a normal service deployment and
   monitor pending/oldest outbox age, consumer lag, and the AI dead-letter path
   while the backlog drains in per-Job version order.
6. Start the new service's Elasticsearch path. Its new-index bootstrap queues
   the Elasticsearch baseline automatically; calling `POST /jobs/reindex`
   remains a safe, idempotent reconciliation. Wait until every durable
   index-sync row is completed with no failed rows.
7. Verify both Elasticsearch and AI projection/version baselines before
   restoring normal traffic.
8. Retain the legacy index for the agreed rollback window, then remove it using
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

The verified local suite contains 429 unit tests. The isolated Docker gate
applies migrations to disposable PostgreSQL 16 and starts Kafka 3.8, authenticated
Redis 7, and Elasticsearch 8.14.3 with index auto-creation disabled. It runs
20 integration tests covering historical baseline/resume/concurrency,
transactional outbox delivery, bulk detail, recommendations, mapping validation,
stable cursor traversal, indexing, reindex, retry/dead-letter, outage, recovery,
and restart behavior:

```bash
docker compose -f compose.test.yml up \
  --build --abort-on-container-exit --exit-code-from job-tests
docker compose -f compose.test.yml down --volumes --remove-orphans
```

The controlled search load gate builds its own pinned PostgreSQL and
Elasticsearch environment and generates exactly 100,000 Jobs (80,000 public).
It verifies NFC, NFD, and accentless Vietnamese search across title,
description, skills, and company name; complete duplicate-free deep cursor
traversals; salary null ordering and short terminal pages; cursor isolation;
and PIT cleanup. It then runs 500 warm-up requests and 10,000 measured requests
at concurrency 32:

```bash
npm run test:search-load
```

The verified local controlled run completed with zero errors and zero source
mismatches, 164.632 requests/second, p95 402.763 ms, and p99 503.771 ms. PIT
contexts were 0 before the run, peaked at 32, and returned to 0. These figures
are reproducible development-gate evidence, not a production SLO or a claim for
multi-replica/CDN traffic.

Swagger: `/docs` directly or `/jobs/docs` through the gateway.
