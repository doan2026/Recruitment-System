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
| Chat | Node + Socket.IO | MongoDB | `/chat` |
| Notification | NestJS | `notification` | `/notifications` |
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
| `cv-events` | Profile | AI | Pending |
| `application-events` | Application | Notification, Admin | Topic-specific contract; verify before new consumers |
| `interview-events` | Interview | Notification | Pending |
| `chat-events` | Chat | Notification | Pending |

Kafka is the only asynchronous cross-service transport. Redis is reserved for
cache, OTP/refresh-session data, BullMQ, and Socket.IO scaling.
