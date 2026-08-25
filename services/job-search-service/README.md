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
| `GET /stats/active?company_id=` | `GET /jobs/stats/active?company_id=` | Internal |
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
The Elasticsearch request timeout defaults to two seconds and is configurable
with `ELASTICSEARCH_REQUEST_TIMEOUT_MS`.

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

After the transaction commits, BullMQ separately queues a source-of-truth
Elasticsearch refresh. That worker indexes only non-expired `PUBLISHED` jobs
and removes all other statuses; its tasks retry eight times with exponential
backoff. `POST /jobs/reindex` only rebuilds Elasticsearch from PostgreSQL and
does not synthesize Kafka domain events.

The migration intentionally does not backfill historical outbox events. A
populated environment must complete this release checklist before enabling the
new producer:

1. Stop and drain every old Job Service instance so no legacy writer remains.
2. Apply the migration separately from application startup.
3. Run an environment-specific baseline/replay plan that has been reviewed for
   duplicate and ordering behavior.
4. Verify the AI projection/version baseline, then start the new service.

Published outbox-row retention cleanup is not automated yet; operators must plan
retention and cleanup separately.

Application Service checks `GET /jobs/:id/exists` before accepting a new
application. It must send `X-Internal-Api-Key` matching `INTERNAL_API_KEY`.
The response distinguishes a missing job, a non-published job, and a passed
deadline, and includes `companyId`, `recruiterId`, and `jobTitle` when the
job exists.

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

The verified local suite contains 39 unit tests. The isolated Docker gate
applies migrations to disposable PostgreSQL 16, starts a real Kafka broker and
runs one transaction/order/delivery integration test:

```bash
docker compose -f compose.test.yml up \
  --build --abort-on-container-exit --exit-code-from job-tests
docker compose -f compose.test.yml down --volumes --remove-orphans
```

Swagger: `/docs` directly or `/jobs/docs` through the gateway.
