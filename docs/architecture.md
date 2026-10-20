# Architecture contract

## Service ownership

| Service | Runtime | PostgreSQL schema / store | Gateway prefix |
| --- | --- | --- | --- |
| Auth | Spring Boot | `auth` | `/auth` |
| Profile | NestJS | `profile` | `/profile` |
| Company | NestJS | `company` | `/companies` |
| Job & Search | NestJS | `job` + Elasticsearch | `/jobs` |
| Application | Spring Boot | `application` | `/applications` |
| Interview | Spring Boot | `interview` | `/interviews` |
| Chat | Go + WebSocket | PostgreSQL `public` (owned chat tables) | `/chat` |
| Notification | Go + SSE | PostgreSQL `public` (owned notification tables) | `/notifications` |
| Video | Go + LiveKit | PostgreSQL `public` (owned video tables) | `/calls` |
| Media | NestJS | `media` + Cloudinary | `/files` |
| Admin | Spring Boot | `admin` | `/admin` |
| AI | FastAPI | `ai` + pgvector | `/ai` |

## Auth REST MVC layers

Auth uses `@RestController` for JSON APIs. Its package layout separates
`controller`, `dto`, `service`, `repository` (`jpa`, `jdbc`, `redis`), `model`,
`config`, `security`, `infrastructure.mail`, `exception` and `support`.
Controllers delegate business work to services; repository adapters own persistence.
DTOs define the HTTP representation, and `@RestControllerAdvice` maps errors.

Auth also owns Recruiter account contact (`fullName`, `phone`) at
`GET/PUT /auth/me/recruiter-contact`. The owner is always the authenticated subject;
current durable role/verification/lock checks apply. These fields are not JWT claims.
Candidate career profile data remains exclusively in Profile. Recruiter onboarding
must use Auth contact APIs rather than Candidate Profile APIs.

Google sign-in binds the Candidate/Recruiter portal to the Redis OAuth state and
one-time exchange code. The callback completes automatically without selecting a
role. Existing linked users must match that portal; OAuth never changes a stored
account role or auto-links a matching email.

The Next.js cookie proxy establishes HttpOnly access/refresh cookies for password,
OTP verification and Google exchange alike. Browser JSON contains only `user`;
the refresh credential stays under `/api/auth-cookie`. Google exchange preserves
the canonical `/auth/google/exchange` path so the one-time HttpOnly binder reaches
Auth. Session hydration cannot invalidate an in-flight Google exchange or replace
a newer login with an earlier response.

Production TLS terminates at nginx. Public HTTPS `/auth/google/exchange` must
reach the Next cookie proxy, and `/auth/callback` must render the Next page.
The cookie proxy calls `http://api-gateway:8080/auth/google/exchange`; this
unpublished internal listener must reach Auth directly. `google_exchange_upstream`
selects Next for port 443 and Auth for the internal hop to prevent recursion.
Google authorization/provider callback routes remain owned by Auth. See
[production Google session fix](google-oauth-production-fix-2026-10-20.md).

The gateway serves both `/applications` and `/applications/` directly. This avoids
an nginx slash redirect cycling with Next.js trailing-slash canonicalization.

## Interview and video scope

Interview currently implements offline scheduling and scoped query/calendar APIs.
An incoming timestamp retains its supplied offset during Jackson deserialization;
the domain checks that offset against the IANA zone, including GMT+7. The frontend
uses `Asia/Ho_Chi_Minh`, displays GMT+7 and reuses the same request ID for a manual
retry of the same scheduling submission.

Video owns separate call IDs and LiveKit room credentials for chat calls. Only
invited participants can join or reject; rejected/ended calls cannot issue new join
tokens and do not appear in active-call lists. There is no implemented binding
between an Interview ID and a Video call ID. Scheduled ONLINE interviews remain
unavailable rather than returning a fabricated room URL.

The internal `/auth/users` directory uses a typed DTO and follows
`AdminUserDirectoryController → AdminUserDirectoryService → AdminUserDirectoryRepository`.
The service rechecks durable admin role and bounds pagination; the repository
uses parameterized SQL with escaped literal email search. Endpoint paths,
JSON field names, JWT contracts and existing transaction boundaries are preserved.
See [Auth Service structure](../services/auth-service/README.md#rest-mvc-structure).

## Admin REST MVC layers

Admin follows Auth's layer layout with `@RestController`, validated DTOs, services,
JDBC repositories, model records, configuration, security filters and infrastructure adapters.
Controllers delegate all privileged decisions and persistence work to services.
Moderation, reports, audit and statistics have separate endpoints/services; HTTP
gateway calls, Kafka consumption, scheduled aggregation and CSV/XLSX generation
have explicit owners. The JDBC/Flyway stack, append-only audit, report version
checks, event idempotency and existing REST/upstream/Kafka contracts are preserved.
See [Admin Service structure](../services/admin-service/README.md#rest-mvc-structure).

## Kafka event contracts

Kafka payloads are topic-specific; there is no implemented global camelCase
envelope. New consumers must follow the producer contract and lock it with a
contract test before implementation.

### `job-events` v1

The Kafka key is the canonical `job_id` UUID. Job & Search publishes this exact
16-field flat snake_case value:

```json
{
  "event_id": "uuid",
  "action": "CREATED | UPDATED | CLOSED | EXPIRED",
  "job_id": "uuid",
  "company_id": "uuid",
  "title": "string",
  "description": "string",
  "skills": ["string"],
  "location": "string",
  "status": "DRAFT | PENDING_APPROVAL | PUBLISHED | CLOSED | EXPIRED",
  "occurred_at": "ISO-8601 timestamp with timezone",
  "schema_version": 1,
  "aggregate_version": 1,
  "requirements": "string",
  "salary_min": "fixed two-decimal string | null",
  "salary_max": "fixed two-decimal string | null",
  "job_type": "FULL_TIME | PART_TIME | REMOTE | INTERNSHIP"
}
```

The AI consumer rejects the obsolete camelCase envelope and unknown fields.
Salary strings map to `NUMERIC(15,2)` in both the Job source of truth and the AI
filtering projection.

The Job mutation and immutable outbox event are one PostgreSQL transaction.
Publication is independent from BullMQ/Elasticsearch, and Admin reindex only
rebuilds Elasticsearch. Delivery is at-least-once: `event_id` is stable for
deduplication and the positive monotonic `aggregate_version` orders each Job.
The publisher prevents a later version from overtaking an unpublished earlier
version, renews its database lease during Kafka I/O, bounds each Kafka request
and retry sequence, then defers failures with capped exponential backoff.

Rollout precondition: the outbox migration intentionally does not auto-backfill
historical events. A populated database needs a reviewed baseline/replay before
the producer is enabled. Automated cleanup/retention for published outbox rows
is not implemented yet.

| Topic | Producer | Consumer | Contract status |
| --- | --- | --- | --- |
| `job-events` | Job & Search | AI, Admin | Exact 16-field snake_case v1; transactional outbox |
| `cv-events` | Profile | AI | Profile private v1; transactional outbox, no signed download URL in events |
| `application-events` | Application | Notification, Admin | Topic-specific contract; verify before new consumers |
| `interview-events` | Interview | Notification | Exact 15-field SCHEDULED v1; transactional outbox; see Interview README |
| `chat-events` | Chat | Notification | Implemented Go producer/consumer contract; verified with browser SSE |

Kafka is the asynchronous cross-service transport. Chat delivers browser messages
over WebSocket and Notification pushes inbox updates over SSE. Redis supports Auth
OTP/OAuth/session data and the services' configured cache/queue mechanisms; Go Chat
does not use the former Socket.IO runtime. MongoDB remains in local Compose for
compatibility and is not the current Go Chat data store.
