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

## Kafka event envelope

```json
{
  "eventId": "uuid",
  "eventType": "job.created",
  "version": 1,
  "occurredAt": "2026-08-17T10:00:00Z",
  "payload": {}
}
```

| Topic | Producer | Consumer |
| --- | --- | --- |
| `job-events` | Job & Search | AI |
| `cv-events` | Profile | AI |
| `application-events` | Application | Notification |
| `interview-events` | Interview | Notification |
| `chat-events` | Chat | Notification |

Kafka is the only asynchronous cross-service transport. Redis is reserved for cache, OTP/refresh-session data, BullMQ, and Socket.IO scaling.
