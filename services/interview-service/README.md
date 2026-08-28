# Interview Service

Spring Boot/Java 21 service for interview scheduling. The current vertical
slices implement the production foundation for **offline scheduling**, its
transactional `SCHEDULED` event, and role-aware query/calendar/availability
APIs. They do not claim that the complete interview/video lifecycle is
finished.

## Implemented in scheduling foundation v1

- `POST /interviews` for an authenticated `RECRUITER`.
- The caller can only schedule themself as interviewer. The request never
  accepts `candidateId`, `jobId`, `companyId` or another `interviewerId`.
- Purpose-scoped Interview → Application authorization sends a distinct
  internal key and the acting Recruiter JWT. Application verifies both,
  verifies MEMBER/OWNER membership and only accepts `REVIEWING`/`INTERVIEW`.
- PostgreSQL stores the authoritative Application snapshot and enforces active
  application-round uniqueness plus Candidate/interviewer overlap using GiST
  exclusion constraints and half-open `[start,end)` ranges.
- The request requires an offset timestamp and IANA time zone. The offset must
  exist for the supplied local time; DST gaps and mismatches are rejected.
- Duration is exactly 30, 45 or 60 minutes. Timestamps are persisted as UTC
  `TIMESTAMPTZ(3)` and interview time must be in the future.
- `(scheduledBy, requestId)` plus a canonical SHA-256 payload hash provides
  idempotent retry. Same payload returns the original row; reuse with another
  payload returns `409`.
- Strict JWT contract: `typ=JWT`, RS256, exact RFC 7638 `kid`, issuer, one exact
  audience, canonical UUIDv4 `sub/jti`, one supported string role, `iat/exp`.
- Responses and errors are private/no-store. The public gateway strips forged
  service identity headers and preserves the `/interviews` prefix.

Online scheduling deliberately returns `INTERVIEW_ONLINE_NOT_READY`. Jitsi
room/token generation must be implemented with its lifecycle task; this
service never generates a fake or reusable room URL.

## Query, calendar and availability v1

- Candidate detail/history/my queries are scoped in SQL to the JWT subject.
  Candidate projections omit Company/Candidate/interviewer/scheduler identity,
  internal notes and audit metadata; an out-of-scope ID returns the same `404`
  as a missing Interview.
- Recruiter requests revalidate the caller's current MEMBER/OWNER Company
  membership on every request. Detail/history/calendar are Company-scoped;
  `/interviews/my` is additionally restricted to the caller as interviewer.
- History requires only `applicationId` for Candidate. Recruiter history must
  include at least one of `applicationId`, `jobId`, `candidateId` or
  `interviewerId`.
- `/interviews/my` accepts `UPCOMING` (default), `PAST`, `ALL` or `RANGE`;
  `RANGE` requires `from` and `to`. Company calendar requires a half-open
  `from`/`to` window of at most 42 days.
- Availability is Recruiter-only and always evaluates the caller as
  interviewer. Candidate/Company identity comes from Application's scheduling
  authorization; the request requires `applicationId`, offset `from`/`to`, an
  IANA `timeZone` and a 30/45/60-minute duration. It searches at most 26 hours
  within the next 92 days on a 15-minute grid.
- Availability is advisory: it neither reserves a slot nor reveals which
  Candidate/interviewer interval is busy. `POST /interviews` and PostgreSQL
  exclusion constraints remain the final concurrency authority.
- Pagination uses an HMAC-SHA256 signed keyset cursor bound to endpoint,
  caller/role/current Company membership, filters, order, limit and a
  first-page `asOf` creation cutoff. The cutoff prevents later-created rows
  entering the page sequence; mutable lifecycle fields remain live. Tampered
  or cross-scope cursors are rejected.

## `interview-events` v1

Creating an Interview and appending its event outbox row occur in the same
PostgreSQL transaction. Kafka delivery is at-least-once: a lease/fence and
`SKIP LOCKED` allow multiple publishers, exponential retry preserves the
stable `event_id`, and a row is marked published only after broker ACK. The
Kafka key is the lowercase canonical `interview_id`.

Foundation v1 emits only `action=SCHEDULED` and `status=SCHEDULED`, with exactly
these 15 fields:

```text
schema_version, event_id, action, interview_id, application_id,
candidate_id, interviewer_id, actor_id, round_number, schedule_revision,
scheduled_start_at, scheduled_end_at, status, aggregate_version, occurred_at
```

Timestamps use exact UTC milliseconds. The contract intentionally excludes
location, notes, request identifiers/hashes, CV/contact data, room URL and join
token. Room credentials must later be obtained from an authenticated join API,
never retained in Kafka. Existing Interview rows are not silently backfilled;
production rollout must make an explicit baseline decision.

## API

```http
POST /interviews
Authorization: Bearer <recruiter-access-token>
Content-Type: application/json

{
  "applicationId": "8ab8c72e-b617-4ae5-901d-961def854321",
  "requestId": "3e4d9230-ce98-4581-94ec-0a7d587abc11",
  "roundNumber": 1,
  "scheduledStart": "2026-09-10T09:00:00+07:00",
  "timeZone": "Asia/Ho_Chi_Minh",
  "durationMinutes": 45,
  "mode": "OFFLINE",
  "location": "Meeting room 2",
  "notes": "Technical interview"
}
```

New rows return `201`; an exact idempotent replay returns `200` and
`Idempotency-Replayed: true`. Important stable errors include
`APPLICATION_ACCESS_DENIED`, `APPLICATION_NOT_SCHEDULABLE`,
`INTERVIEW_CANDIDATE_CONFLICT`, `INTERVIEW_INTERVIEWER_CONFLICT`,
`INTERVIEW_ROUND_ALREADY_SCHEDULED` and `INTERVIEW_IDEMPOTENCY_CONFLICT`.

Read endpoints:

```http
GET /interviews?applicationId=<uuid>&status=SCHEDULED&limit=20
GET /interviews/my?period=UPCOMING&limit=20
GET /interviews/calendar?from=<offset-date-time>&to=<offset-date-time>
GET /interviews/availability?applicationId=<uuid>&from=<offset-date-time>&to=<offset-date-time>&timeZone=Asia%2FHo_Chi_Minh&durationMinutes=45
GET /interviews/{interviewId}
```

`status` is the only repeatable query parameter. Unknown parameters, repeated
scalar parameters and duplicate statuses return `400`; `limit` is `1..50`.
All read responses and errors are private/no-store and vary on `Authorization`.

OpenAPI is available at `/docs`; readiness is
`/actuator/health/readiness`.

## Required configuration

Copy `.env.example` to the runtime secret configuration. At minimum configure:

- PostgreSQL URL/user/password with schema `interview`.
- trusted Auth RSA public key, issuer and audience;
- `APPLICATION_SERVICE_URL` and exact allowlisted host;
- a non-placeholder `APPLICATION_INTERNAL_API_KEY` of at least 32 bytes. It
  must equal Application's inbound `INTERNAL_API_KEY_INTERVIEW` and must differ
  from every other service-direction key;
- `COMPANY_SERVICE_URL`, exact host allowlist and bounded request timeout;
- a non-placeholder `INTERVIEW_CURSOR_HMAC_KEY` of at least 32 bytes, distinct
  from service-to-service keys. Rotating it intentionally invalidates cursors;
- exact frontend `CORS_ORIGINS`;
- Kafka brokers/topic and `INTERVIEW_EVENT_PUBLISHER_ENABLED`; outbox poll,
  lease, batch, retry, publish-timeout and backlog-age bounds have safe local
  defaults documented in `.env.example`.

The outbound HTTP clients reject redirects, credentials/path/query/fragment in
their base URL, non-allowlisted hosts, responses over 16 KiB, wrong content
type and unknown fields. Application also requires an echoed ID; Company uses
an exact membership envelope and fails closed on malformed/unavailable data.
Connect/read timeout defaults to 2 s.

## Verification

Unit/WebMvc/security/client/event/query suite (143 tests):

```bash
docker run --rm \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/interview-service:/app" \
  -w /app maven:3.9-eclipse-temurin-21 \
  mvn test
```

Full suite, including sixteen PostgreSQL 16/Kafka 3.8 integration tests:

```bash
docker run --rm --network host \
  -e TESTCONTAINERS_HOST_OVERRIDE=localhost \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/interview-service:/app" \
  -w /app maven:3.9-eclipse-temurin-21 \
  mvn verify -Pintegration-test
```

The integration gate covers clean/repeated Flyway deployment, JPA validation,
UTC persistence, adjacent slots, idempotency collision, active round, cancelled
slot release, direct-SQL protection, parallel Candidate/interviewer races,
Interview/outbox rollback, exact outbox-to-Kafka key/payload delivery, V3
snapshot immutability, SQL-scoped detail/redaction, tied keyset pagination,
half-open Company calendar and privacy-preserving advisory availability.

## Explicit backlog

`InterviewFeedback`, arbitrary interviewer/panel membership authorization,
Candidate confirmation/reschedule, cancel/no-show, Jitsi, remaining lifecycle
event actions, reminders and frontend/deployed E2E remain separate tasks in
`TIEN_DO_DU_AN.md`.
