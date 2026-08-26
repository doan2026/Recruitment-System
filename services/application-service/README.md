# Application Service

This Spring Boot 3 / Java 21 service owns candidate submission, bookmarks,
application tracking, recruiter evaluations, the application pipeline, job
offers, the company-wide Recruiter Dashboard, and on-demand AI match
scores. Nginx strips the `/applications` gateway prefix before forwarding those
requests. The dedicated `/offers` gateway route preserves its prefix.

| Internal | Gateway | Access |
| --- | --- | --- |
| `POST /` | `POST /applications/` | CANDIDATE |
| `GET /my` | `GET /applications/my` | CANDIDATE |
| `GET /{applicationId}` | `GET /applications/{applicationId}` | CANDIDATE, RECRUITER |
| `GET /` | `GET /applications/` | RECRUITER |
| `GET /stats` | `GET /applications/stats` | RECRUITER |
| `POST /{applicationId}/match-score/refresh` | `POST /applications/{applicationId}/match-score/refresh` | RECRUITER |
| `PATCH /{applicationId}/status` | `PATCH /applications/{applicationId}/status` | RECRUITER |
| `POST /{applicationId}/evaluation` | `POST /applications/{applicationId}/evaluation` | RECRUITER |
| `POST /{applicationId}/offer` | `POST /applications/{applicationId}/offer` | RECRUITER |
| `PATCH /offers/{offerId}/respond` | `PATCH /offers/{offerId}/respond` | CANDIDATE |
| `PATCH /{applicationId}/withdraw` | `PATCH /applications/{applicationId}/withdraw` | CANDIDATE |
| `POST, GET /bookmarks` | `POST, GET /applications/bookmarks` | CANDIDATE |
| `DELETE /bookmarks/{jobId}` | `DELETE /applications/bookmarks/{jobId}` | CANDIDATE |
| `GET /actuator/health` | Direct health check | Public |
| `GET /docs` | `GET /applications/docs` | Public |

Recruiter access is scoped by Company Service membership. The
`GET /by-user/{userId}` contract must return both `companyId` and
`memberRole`. Both `MEMBER` and `OWNER` can list, view, and transition
applications for every job in their company, including jobs created by another
recruiter. A recruiter from another company is denied. This company-wide
Application Pipeline policy does not change Job Service ownership rules:
`MEMBER` can still edit or delete only jobs they created, while `OWNER` can
manage every job.

Recruiter Dashboard is available through
`GET /applications/stats?company_id=<uuid>`. The requested company must match
the Company Service membership resolved from the Recruiter JWT; both `MEMBER`
and `OWNER` receive company-wide aggregates. Authorization fails closed before
Application DB or Job Service access.

Optional `from` and `to` are ISO-8601 instants and must be supplied together.
The range is half-open (`from` inclusive, `to` exclusive) and limited to 366
days. Without them, the service returns 30 local calendar dates including
today: from the start of 29 days ago through the start of tomorrow in the
requested timezone. `timezone` accepts an IANA zone supported by both Java and
PostgreSQL (default `UTC`), and `granularity` is `DAY`, `WEEK`, or `MONTH`
(default `DAY`).

Every Application aggregate selects the cohort whose `applied_at` is in that
range. Status/source maps and the time series are zero-filled. Per-job counts
use current statuses and include only jobs with at least one Application in the
cohort. The funnel counts distinct cohort Applications that ever reached each
stage in `ApplicationHistory`, including transitions after `to`; this keeps it
consistent with the current-status summary.

The active-job total comes from Job Service's authoritative internal
`GET /stats/active?company_id=` endpoint. Network failures, rate limiting, and
HTTP 5xx responses use a fail-soft result:
`summary.activeJobs.count=null`, `available=false`, and a
`JOB_SERVICE_UNAVAILABLE` warning. Other HTTP 4xx responses or an invalid
success payload fail with `JOB_SERVICE_INVALID_RESPONSE` and HTTP 502 instead
of hiding a service contract or credential error.

Bookmark creation still verifies one Job through the authoritative internal
`GET /{jobId}/exists` contract. Bookmark listing no longer performs one Job
Service request per saved row. It keeps the database order, extracts the Job
IDs, and calls the internal `POST /details/bulk` endpoint with
`X-Internal-Api-Key` in chunks of at most 100 unique IDs:

```json
{
  "jobIds": [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002"
  ]
}
```

The Job Service response must partition every requested ID exactly once between
`data.items` and `data.unavailableJobIds`; missing, extra, duplicate, or
overlapping IDs are rejected as `JOB_SERVICE_INVALID_RESPONSE`. Available
items enrich the existing bookmark `job` object additively with the complete
public Job detail. An unavailable ID keeps the bookmark but returns
`job=null`. If any bulk chunk fails, listing remains fail-soft and returns all
saved bookmarks in the original order with `job=null`, rather than failing the
Candidate's bookmark collection.
AI match scoring is an explicit recruiter action through
`POST /applications/{applicationId}/match-score/refresh`. It is deliberately
not part of Candidate submission, so an unavailable AI Service cannot block the
core application flow. The request contains only the aggregate version:

```json
{
  "expectedVersion": 2
}
```

The service loads the authoritative `cvId` and `jobId` from the Application,
then authorizes the Recruiter through Company Service before making an AI call.
It calls AI Service directly at `POST /match` (gateway contract:
`POST /ai/match`) with `X-Internal-Api-Key` and this snake-case payload:

```json
{
  "cv_id": "uuid",
  "job_id": "uuid"
}
```

The expected response follows the shared envelope and echoes both identifiers:

```json
{
  "data": {
    "cv_id": "uuid",
    "job_id": "uuid",
    "score": 0.85456,
    "reason": null
  },
  "meta": null
}
```

AI scores must be in `0..1`; Application Service verifies the echoed IDs,
converts the score to `0..100`, and rounds half-up to two decimal places before
storage. A null score with a non-blank reason returns `AI_MATCH_NOT_READY`
(409). Network errors, HTTP 429, and HTTP 5xx return
`AI_SERVICE_UNAVAILABLE` (503); malformed data and other HTTP 4xx responses
return `AI_SERVICE_INVALID_RESPONSE` (502). Every failure preserves the
previous score.

The write uses `expectedVersion` in one atomic compare-and-set and returns the
incremented version. Refreshing a score does not change application status or
`updated_at`, and does not create ApplicationHistory or outbox events. The
actual AI `/match` implementation, embedding tables, and Kafka consumers
remain tracked under P11; this service is contract-ready for that provider.

Recruiter evaluations are internal records. A `MEMBER` or `OWNER` can create
one evaluation for each application in their company, even when another
recruiter created the job. The evaluator is always taken from the JWT subject
and the timestamp is generated by the service. The overall score and each
named criterion use the `0..100` scale with at most two decimal places;
criteria must contain 1 to 20 entries and the optional note is limited to 2,000
characters. Evaluation data is deliberately absent from every Candidate
response DTO.

```json
{
  "score": 85.5,
  "criteria": {
    "technical": 90,
    "communication": 81.5
  },
  "note": "Strong backend fundamentals"
}
```

Each application can have at most one offer, and an offer can only be sent
while the application is in `INTERVIEW`. Creation requires a positive salary
with at most two decimal places, a non-past start date, a non-blank position of
at most 200 characters, an optional note of at most 2,000 characters, a future
`expiresAt`, and `expectedApplicationVersion`. Optional `fileId` and `fileUrl`
must be supplied together; `fileUrl` must be an absolute HTTP(S) URL. The
service currently validates and stores this reference, while canonical file
metadata and ownership verification remain dependent on the internal File
Service contract tracked in P09.

Only the Candidate who owns the application can respond. The request carries
`ACCEPTED` or `DECLINED`, `expectedOfferVersion`, and
`expectedApplicationVersion`; declining also requires a reason. Only an
unexpired `SENT` offer is respondable. Acceptance atomically changes the offer
to `ACCEPTED` and the application to `HIRED`; declining changes them to
`DECLINED` and `REJECTED`. Repeated, expired, and concurrent responses return
conflict errors without partially updating the offer, application, history, or
outbox.

Sending an offer writes the Offer, moves the Application to `OFFER`, appends
history, and stores `OFFER_SENT` in the transactional outbox. Response events
use `STATUS_CHANGED`. Offer events add `actor_id`, `offer_id`, `offer_status`,
and `offer_version`, retain `recruiter_id` from the Application, and never
include salary, notes, decline reasons, `fileId`, or `fileUrl`.

Submission performs these checks in order:

1. Verify the Job through `GET /jobs/:id/exists` using
   `X-Internal-Api-Key`.
2. Verify that the selected CV appears in the authenticated candidate's
   `GET /profile/cv?user_id=` response.
3. Reject an existing active application.
4. Enforce a 30-day cooldown after the latest `REJECTED` application.
5. Store `Application(APPLIED)`, initial `ApplicationHistory`, and a Kafka
   outbox row in one database transaction.

The database also has a partial unique index for active candidate/job pairs,
which protects against two concurrent submission requests. The outbox publisher
sends `application-events` with a stable `event_id` and exponential retry.

```json
{
  "event_id": "uuid",
  "action": "STATUS_CHANGED",
  "application_id": "uuid",
  "job_id": "uuid",
  "job_title": "Backend Engineer",
  "candidate_id": "uuid",
  "recruiter_id": "uuid",
  "from_status": null,
  "to_status": "APPLIED",
  "occurred_at": "2026-08-24T00:00:00Z"
}
```

```bash
mvn test
mvn package

# Requires Docker; starts disposable PostgreSQL 16 and Apache Kafka containers.
mvn verify -Pintegration-test
```

The integration profile verifies Flyway/JPA against PostgreSQL, transactional
pipeline, Offer, and AI match-score updates, MEMBER/OWNER company-wide access,
cross-company denial, Evaluation JSONB persistence and privacy, Recruiter
Dashboard cohort/funnel semantics, `DAY/WEEK/MONTH` time-series buckets and DST
boundaries, outbox delivery to a real Kafka consumer, and published-row
idempotency. AI Match verification covers score replacement, optimistic-lock
conflicts, downstream failure preservation, the `0..100` database constraint,
and the absence of history/outbox side effects. The verified Application
Service suite passes 173 unit tests and 35 PostgreSQL/Kafka integration tests.
