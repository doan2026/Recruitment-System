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

## Kafka event contracts

Kafka payloads are topic-specific; there is no implemented global camelCase
envelope. New consumers must follow the producer contract and lock it with a
contract test before implementation.

### `job-events` v1

The Kafka key is the canonical `job_id` UUID. Job & Search currently publishes
this flat snake_case value:

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
  "occurred_at": "ISO-8601 timestamp with timezone"
}
```

The AI consumer rejects the obsolete camelCase envelope. It accepts optional v1
extensions `schema_version`, `aggregate_version`, `requirements`,
`salary_min`, `salary_max` and `job_type`, but the Job producer does not
emit them yet. In particular, deterministic ordering across concurrent producer
workers still requires a monotonic `aggregate_version` and durable outbox on
the producer side.

| Topic | Producer | Consumer | Contract status |
| --- | --- | --- | --- |
| `job-events` | Job & Search | AI, Admin | Flat snake_case v1 locked for AI |
| `cv-events` | Profile | AI | Pending |
| `application-events` | Application | Notification, Admin | Topic-specific contract; verify before new consumers |
| `interview-events` | Interview | Notification | Pending |
| `chat-events` | Chat | Notification | Pending |

Kafka is the only asynchronous cross-service transport. Redis is reserved for
cache, OTP/refresh-session data, BullMQ, and Socket.IO scaling.
