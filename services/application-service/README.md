# Application Service

This Spring Boot 3 / Java 21 service owns candidate submission, bookmarks,
application tracking, recruiter evaluations, the application pipeline, job
offers, the company-wide Recruiter Dashboard, and on-demand AI match
scores. Nginx strips the `/applications` gateway prefix before forwarding those
requests. The dedicated `/offers` gateway route preserves its prefix. Gateway
traffic cannot reach `/applications/internal...`, and public Profile/Application
routes discard client-supplied internal identity headers.

| Internal | Gateway | Access |
| --- | --- | --- |
| `POST /` | `POST /applications/` | CANDIDATE |
| `GET /my` | `GET /applications/my` | CANDIDATE |
| `GET /{applicationId}` | `GET /applications/{applicationId}` | CANDIDATE, RECRUITER |
| `GET /?job_id=&status=&appliedFrom=&appliedTo=&skills=&sort=&page=&size=` | `GET /applications/?job_id=&status=&appliedFrom=&appliedTo=&skills=&sort=&page=&size=` | RECRUITER |
| `GET /stats` | `GET /applications/stats` | RECRUITER |
| `POST /{applicationId}/match-score/refresh` | `POST /applications/{applicationId}/match-score/refresh` | RECRUITER |
| `PATCH /{applicationId}/status` | `PATCH /applications/{applicationId}/status` | RECRUITER |
| `POST /{applicationId}/evaluation` | `POST /applications/{applicationId}/evaluation` | RECRUITER |
| `GET /{applicationId}/cv` | `GET /applications/{applicationId}/cv` | RECRUITER |
| `POST /{applicationId}/cv/download-url` | `POST /applications/{applicationId}/cv/download-url` | RECRUITER |
| `POST /{applicationId}/offer` | `POST /applications/{applicationId}/offer` | RECRUITER |
| `PATCH /offers/{offerId}/respond` | `PATCH /offers/{offerId}/respond` | CANDIDATE |
| `PATCH /{applicationId}/withdraw` | `PATCH /applications/{applicationId}/withdraw` | CANDIDATE |
| `POST, GET /bookmarks` | `POST, GET /applications/bookmarks` | CANDIDATE |
| `DELETE /bookmarks/{jobId}` | `DELETE /applications/bookmarks/{jobId}` | CANDIDATE |
| `GET /actuator/health` | Direct health check | Public |
| `GET /docs` | `GET /applications/docs` | Public |

## Access-token verification and JWKS rotation

Every non-public, non-internal route accepts exactly one raw
`Authorization: Bearer <compact-jwt>` header. The scheme is
case-insensitive, but it must be followed by exactly one ASCII space; duplicate
headers, commas, controls, trailing data, malformed compact tokens, and tokens
larger than 8 KiB are rejected before signature verification.

Application Service verifies the canonical Auth access-token contract: exact
protected header fields `alg=RS256`, `typ=JWT`, and RFC 7638 public-key
thumbprint `kid`; exact configured issuer and scalar audience; lowercase UUIDv4
`sub` and `jti`; one string role from `CANDIDATE`, `RECRUITER`, or `ADMIN`; and
integral, ordered, non-expired `iat`/`exp` claims with at most 60 seconds of
future clock skew. The same decoder validates the Recruiter token forwarded by
Interview Service; Profile and Interview service-key boundaries remain
separate.

`JWT_ISSUER` and `JWT_AUDIENCE` are mandatory. Configure exactly one key
source: `JWT_PUBLIC_KEY`, `JWT_PUBLIC_KEY_PATH`, or `JWT_JWKS_URI`. Static RSA
public keys are validated and cached once. JWKS mode additionally requires an
exact lowercase hostname in `JWT_JWKS_ALLOWED_HOSTS`; HTTPS and the fixed
`/auth/.well-known/jwks.json` path are mandatory unless development HTTP is
explicitly enabled with `JWT_ALLOW_INSECURE_JWKS=true`.

JWKS retrieval disables redirects and compression, has bounded timeout/body
limits, accepts only an exact 1–16 key RSA signing set, and validates every
`kid` as its RFC 7638 thumbprint. Current and previous keys are cached with a
monotonic TTL, single-flight refresh, and unknown-key cooldown. A refresh is
published atomically, and an expired key is never served stale. Invalid tokens
receive a generic no-store 401; a temporarily unavailable key set receives a
sanitized no-store 503; unexpected verification failures receive a sanitized
500. Token, PEM, JWKS URL, and upstream response details are never returned.

Recruiter access is scoped by Company Service membership. The
`GET /by-user/{userId}` contract must return both `companyId` and
`memberRole`. Both `MEMBER` and `OWNER` can list, view, and transition
applications for every job in their company, including jobs created by another
recruiter. A recruiter from another company is denied. This company-wide
Application Pipeline policy does not change Job Service ownership rules:
`MEMBER` can still edit or delete only jobs they created, while `OWNER` can
manage every job.

## Interview scheduling authorization contract

Interview Service obtains an authoritative, purpose-limited scheduling
snapshot through the Swagger-hidden
`POST /internal/v1/interview-scheduling/authorize` endpoint. The strict request
contains only `{applicationId}`. It must carry exactly one
`X-Internal-Service: interview-service`, exactly one dedicated
`X-Internal-Api-Key`, and exactly one forwarded Recruiter bearer token.
Application Service independently verifies that JWT, requires its canonical
UUID subject and `RECRUITER` role, then verifies `MEMBER` or `OWNER` membership
through Company Service. The membership company must equal the stored
Application company, and the Application must be in `REVIEWING` or `INTERVIEW`.

The no-store response is limited to `applicationId`, `jobId`, `companyId`,
`candidateId`, `status`, and `applicationVersion`. It deliberately excludes
CV identity/content, cover letter, recruiter identity, evaluations, offers,
and timeline. Interview Service derives its scheduling ownership fields only
from this response, not from public request data. The directional
`INTERNAL_API_KEY_INTERVIEW` must be a non-placeholder value of at least 32
bytes and must differ from Profile inbound/outbound and other shared internal
keys.

## Canonical Profile CV contract

Candidate submission no longer lists Candidate CVs and scans a permissive
response. Application calls `POST /internal/v2/cvs/verify` with both
`X-Internal-Service: application-service`/`X-Internal-Api-Key` and the
Candidate bearer token from the submission request. Profile independently
verifies the strict Candidate JWT and requires its subject to equal the
requested `candidateId`. Application then validates the exact response
envelope, echoed candidate/CV identifiers, Media-backed file ID, type,
deleted state, aggregate version, timestamps, and the names-only
`profileSkillSnapshot`. Snapshot schema version 1, the positive Profile
aggregate version, the 100-name cap, Unicode-normalized names, length/control
rules, and case-insensitive uniqueness are all checked at this trust boundary.
Missing, wrong-owner, deleted, and legacy URL-only revisions remain the same
public `CV_NOT_AVAILABLE` result. Profile keeps v1 unchanged so older
Application replicas can drain during a rolling deployment.

Recruiters access the immutable revision selected at submission through:

- `GET /applications/{applicationId}/cv`, whose public data is limited to
  `cvId`, `title`, `type`, `isDeleted`, and `createdAt`.
- `POST /applications/{applicationId}/cv/download-url`, whose public data is
  limited to `cvId`, short-lived HTTPS `url`, and `expiresAt`.

Both endpoints resolve Company membership before querying Application or
Profile, scope the Application lookup by `applicationId` plus the authorized
`companyId`, and derive `candidateId`/`cvId` only from the stored Application.
The Recruiter bearer token is never forwarded to Profile. Application calls
Profile detail/download with its service identity, validates the exact echoed
revision, and permits a soft-deleted historical revision because an existing
Application must continue to reference what was submitted. Both public
responses use `Cache-Control: no-store`; neither response exposes Candidate
identity, `fileId`, stable file URL, Media reference, builder content, Profile
PII, aggregate version, or local first-use metadata.

Flyway V6 adds the durable `application_cv_usage` ledger. Migration takes a
write-blocking lock while readers continue, rejects pre-existing cross-Candidate reuse of one
`cvId`, and backfills every existing Application. An `AFTER INSERT` trigger
upserts `first_used_at` and `application_count` in the same transaction as
Application creation; rollback therefore leaves no false usage evidence. A
separate trigger makes Application identity, Candidate, CV, Job, Company,
Recruiter, and applied time immutable. The ledger has no FK back to
Application, survives later Application-row deletion, and treats every status
as used.

Profile can query that authority through the Swagger-hidden
`POST /internal/v1/cv-usages/lookup`, authenticated only as
`X-Internal-Service: profile-service` with its dedicated key. The request is
`{candidateId, cvId}` and the response is
`{candidateId, cvId, used, firstUsedAt, applicationCount}`; the internal
response is also `no-store`. A mismatched Candidate for an already-used
`cvId` fails closed. This lookup remains backward compatible for soft-delete
and first-use mirroring, but a `used=false` result alone never authorizes hard
delete.

Flyway V7 closes that lookup-to-delete race with a permanent Application-owned
submission gate. Every Application insert creates and locks the gate before
the V6 usage trigger runs; the Java submission transaction takes the same lock
to return the existing generic `CV_NOT_AVAILABLE` contract, while a database
`BEFORE INSERT` trigger protects rolling deployments and direct SQL. Gate rows
are owner-bound, cannot be removed or reopened, and can move only once from
`OPEN` to `DELETE_FENCED`. V7 also makes both gate and usage triggers resolve
`TG_TABLE_SCHEMA`, so isolated Flyway schemas cannot write into the deployed
`application` schema.

Profile acquires the irreversible decision through the Swagger-hidden
`POST /internal/v1/cv-deletion-fences/acquire`, using the same dedicated
Profile-to-Application identity. The strict request is
`{candidateId, cvId, deletionRequestId}` with UUIDv4 values. The exact request
is idempotent and returns one of two no-store responses:

- `FENCED`: `fencedAt` is present, `firstUsedAt` is null and
  `applicationCount` is zero. No Application for that `cvId` can commit after
  this response, so Profile may continue its durable local deletion saga.
- `USED`: `fencedAt` is null, authoritative `firstUsedAt` is present and
  `applicationCount` is positive. Profile must retain the immutable snapshot.

A different request for an already-fenced CV, owner mismatch, malformed
response state, unsafe JSON integer count, timeout, or authentication failure
all fail closed. The fence intentionally has no lease, expiry, cancel, or
reopen endpoint: an expiring reservation could lapse between the remote ACK
and Profile's delete commit and recreate the original race.

## Application-time skill snapshot and recruiter filter

Flyway V8 stores the Profile skill projection that was observed at submission.
The Application row carries immutable snapshot schema/Profile aggregate
metadata, while `application_profile_skill_snapshots` stores the exact display
name plus a database-generated normalized name used only for filtering. The
Application, snapshot rows, initial history, V6 usage ledger update, and Kafka
outbox row commit or roll back together. Existing Applications keep null
snapshot metadata and receive no historical backfill: current Profile data
cannot reconstruct what a Candidate had declared at an earlier submission.
Snapshot metadata and child rows cannot be edited or independently deleted;
deleting the parent Application may still cascade its child rows.

Recruiters may filter the company-scoped pipeline through repeated or
comma-separated query values, for example
`GET /applications/?skills=Java,Spring&skills=Kafka`. At most ten unique,
non-blank names are accepted after NFKC normalization and trimming. Matching
uses `ANY` semantics and exact, case-insensitive names; it does not use
substrings. Blank values, control characters, names longer than 120 code
points, duplicates, and more than ten names return `INVALID_SKILL_FILTER` with
HTTP 400. The predicate composes with job, status, submission-time, sorting,
and pagination filters. A correlated `EXISTS` avoids duplicate Applications
when several requested skills match, and UUID is the stable final sort key.
Legacy Applications and submissions whose captured snapshot was empty remain
visible without a skill filter and do not match when one is active. Listing
reads only the immutable Application-owned snapshot, never calls live Profile,
does not return skill names or add them to Kafka events, and sends
`Cache-Control: private, no-store` plus `Vary: Authorization`.

These names are self-declared Profile data captured at application time. They
are a recruiter discovery aid, not proof of PDF content, and must not drive
automatic rejection. Root Nginx uses a query-free access-log format for
`/applications/`; production gateways, APM, tracing, and upstream proxies must
preserve that redaction or apply restricted access and short retention. Roll
out Profile v2 first, apply V8, then deploy the Application
writer/filter and drain replicas still calling Profile v1. Historical rows
remain unbackfilled by design.

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
include salary, notes, decline reasons, `fileId`, or `fileUrl`. Every v1 event
includes the acting user in nullable `actor_id` and the resulting Application
state in `aggregate_version`; this version can skip values when a non-event
mutation, such as a match-score update, increments the same aggregate.

Submission performs these checks in order:

1. Verify the Job through `GET /jobs/:id/exists` using
   `X-Internal-Api-Key`.
2. Verify the selected CV through Profile's
   `POST /internal/v2/cvs/verify`, using the Application service key plus the
   forwarded Candidate bearer JWT and validating the exact echoed owner/CV and
   names-only Profile skill snapshot.
3. Lock the V7 Application-owned CV submission gate in the database
   transaction and reject a permanent deletion fence.
4. Reject an existing active application.
5. Enforce a 30-day cooldown after the latest `REJECTED` application.
6. Store `Application(APPLIED)`, its V8 skill snapshot metadata/names, initial
   `ApplicationHistory`, the V6 CV-usage ledger update, and a Kafka outbox row
   in one database transaction.

The database also has a partial unique index for active candidate/job pairs,
which protects against two concurrent submission requests. The outbox publisher
sends `application-events` with a stable `event_id` and exponential retry. The
canonical v1 JSON Schema and producer fixtures live under
`contracts/events/`.

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "action": "STATUS_CHANGED",
  "application_id": "uuid",
  "job_id": "uuid",
  "job_title": "Backend Engineer",
  "candidate_id": "uuid",
  "recruiter_id": "uuid",
  "actor_id": "candidate uuid",
  "from_status": null,
  "to_status": "APPLIED",
  "aggregate_version": 0,
  "occurred_at": "2026-08-24T00:00:00Z"
}
```

```bash
export PROFILE_SERVICE_URL='http://localhost:3000'
export PROFILE_INTERNAL_API_KEY='replace-with-a-distinct-application-to-profile-key-of-at-least-32-bytes'
export INTERNAL_API_KEY_PROFILE='replace-with-a-distinct-profile-to-application-key-of-at-least-32-bytes'
export INTERNAL_API_KEY_INTERVIEW='replace-with-a-distinct-interview-to-application-key-of-at-least-32-bytes'

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
and the absence of history/outbox side effects. CV-contract coverage includes
dual-auth submission verification, strict Profile-response validation,
Company-first recruiter authorization, minimal/no-store public DTOs, internal
key hardening, V6 backfill/trigger/rollback/immutability, cross-Candidate
rejection, usage retention after Application deletion, and usage lookup. The
V7 coverage includes isolated-schema writes, permanent/idempotent fences,
owner/request conflicts, rollback, database immutability, unsafe JSON counts,
and both deterministic submit-versus-fence lock schedules. V8 coverage includes
V7-to-V8 migration without historical backfill, strict v2
Profile parsing, transactional snapshot persistence/rollback, metadata and
child-row protection, exact `ANY` filtering, combined filters, company
isolation, legacy/empty-snapshot behavior, and deterministic tied-value
pagination. The verified Application Service suite passes 282
unit/WebMvc/security tests and 63 PostgreSQL/Kafka integration tests.

In Root Compose, use three distinct keys: `PROFILE_INTERNAL_API_KEY_APPLICATION`
maps to Application's `PROFILE_INTERNAL_API_KEY` and Profile's
`INTERNAL_API_KEY_APPLICATION`; `APPLICATION_INTERNAL_API_KEY_PROFILE` maps to
Application's `INTERNAL_API_KEY_PROFILE`; and
`APPLICATION_INTERNAL_API_KEY_INTERVIEW` maps to Application's
`INTERNAL_API_KEY_INTERVIEW` and Interview's outbound Application key. Each
key must be a non-placeholder value of at least 32 bytes.
