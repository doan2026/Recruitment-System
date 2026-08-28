# Notification Service

NestJS/Prisma service that owns the private notification inbox in the
PostgreSQL `notification` schema. The current vertical slices consume the
canonical `application-events` v1 topic and the `SCHEDULED` foundation of
`interview-events` v1, then project safe in-app notifications.

## Implemented scope

- Canonical Application event v1 parser with a bounded legacy dual-read path.
- Dedicated Application and Interview Kafka consumer groups with manual offset
  commit, independent first-join backlog cutoffs, durable idempotency and
  poison quarantine.
- Atomic `ProcessedEvent` + `Notification` + `IN_APP` delivery-log writes.
- Candidate/Recruiter recipient mapping for application submission, pipeline,
  withdrawal, Offer sent, accepted and declined events.
- Candidate-only `INTERVIEW_SCHEDULED` projection with a generic message and a
  minimal private deep-link payload.
- JWT-owner-scoped inbox list, unread count, idempotent read and cutoff-based
  read-all APIs.
- HMAC-signed keyset cursors bound to the authenticated user and type filter.
- Strict RS256/JWKS or static-PEM verification, private no-store responses,
  readiness checks and a non-root production image.

The Prisma migration also reserves `DeviceToken`, `NotificationSetting`, and
PUSH/EMAIL `NotificationLog` persistence for later delivery slices. Device
registration, BullMQ workers, FCM, SMTP, the remaining Interview lifecycle,
the Chat consumer and reminder scheduling are not implemented yet.

## Application event contract

The Kafka key must be the lowercase canonical UUID in `application_id`. The
value is the flat snake_case schema at
`../application-service/contracts/events/application-events.v1.schema.json`.
Every v1 event contains `schema_version=1`, a stable `event_id`, resulting
`aggregate_version`, nullable `actor_id`, both participant IDs and an exact UTC
`occurred_at`. Offer events add the complete `offer_id`, `offer_status`, and
`offer_version` trio.

Valid Offer transitions are exact:

- `OFFER_SENT`: `INTERVIEW -> OFFER`, `offer_status=SENT`.
- Candidate acceptance: `OFFER -> HIRED`, `offer_status=ACCEPTED`.
- Candidate decline: `OFFER -> REJECTED`, `offer_status=DECLINED`.

The event deliberately excludes salary, notes, decline reason, file metadata,
CV content and contact data. Notification payloads retain only IDs, target
status and a local deep link.

Delivery is at least once. A fresh v1 group starts from the retained beginning
so service startup order cannot lose events, but a required, stable
`NOTIFICATION_APPLICATION_REPLAY_AFTER` cutoff prevents older retained Kafka
records from becoming fresh unread items. Records before the cutoff are still
ledgered and committed; records at/after it are projected. Set the cutoff once
to the reviewed first-rollout UTC instant and never move it forward for the
same consumer group. `(topic,event_id)` and the payload hash make replay
idempotent and detect event-ID collisions. Invalid events and collisions store
only hashes, Kafka position and a safe error code before the offset is
committed. Transient database/broker errors do not commit the offset. Inbox
`created_at` is trusted database receive time, never the producer clock, so a
skewed event cannot corrupt pagination or read-all cutoffs.

## Interview event contract

The `interview-events` Kafka key is the lowercase canonical UUID in
`interview_id`. Foundation v1 accepts exactly `schema_version=1`,
`action=SCHEDULED` and `status=SCHEDULED`, with these fields and no others:

```text
schema_version, event_id, action, interview_id, application_id,
candidate_id, interviewer_id, actor_id, round_number, schedule_revision,
scheduled_start_at, scheduled_end_at, status, aggregate_version, occurred_at
```

The actor must equal the interviewer; round is 1–20; revision is positive;
aggregate version is a non-negative JSON-safe integer; all timestamps are UTC
and the end must be after the start. Unknown fields are rejected, including
`room_url`, join tokens, location, notes and feedback. Those details belong
behind the authorized Interview API and must never enter retained Kafka data,
poison rows or Notification payloads.

The in-app projection is owned only by `candidate_id`. It stores interview and
application IDs, action, start/end, round, revision and the local deep link.
It does not copy location, notes, room credentials or participant contact data.
The dedicated group `notification-interview-inbox-v1` starts at retained
beginning; `NOTIFICATION_INTERVIEW_REPLAY_AFTER` prevents reviewed historical
records from becoming fresh unread items while still ledgering them.

## HTTP API

All inbox routes derive ownership only from the JWT subject. They never accept
`userId` as input.

| Endpoint | Description | Access |
| --- | --- | --- |
| `GET /notifications?type=&limit=&cursor=` | Keyset-paginated private inbox | Authenticated owner |
| `GET /notifications/unread-count` | Current owner's unread total | Authenticated owner |
| `PATCH /notifications/:id/read` | Idempotently mark one owned row read | Authenticated owner |
| `PATCH /notifications/read-all` | Mark rows at/before a DB-clock cutoff | Authenticated owner |
| `GET /health/live` | Process liveness | Public |
| `GET /health/ready` | PostgreSQL + both Kafka group readiness | Public |

The list limit defaults to 20 and is bounded to 1–50. The cursor is opaque,
limited to 1024 characters and HMAC-bound to user, filter, timestamp and UUID.
Cross-owner reads return the same 404 as a missing notification. Successful
and error responses set `Cache-Control: private, no-store`, `Pragma: no-cache`
and `Vary: Authorization`; the gateway also applies those headers with
`always` and logs no notification query string or referrer.

## Authentication and configuration

Access tokens must use RS256, `typ=JWT`, an RFC 7638 public-key thumbprint
`kid`, exact issuer/audience, UUID v4 `sub/jti`, a known system role, integer
`iat/exp`, `exp > iat`, and no `iat` over 60 seconds in the future. Static PEM
is materialized at startup, must be RSA with at least 2048 bits and must match
the token `kid`.

JWKS is an alternative when `JWT_JWKS_URI` is set. HTTPS is required unless
development explicitly enables insecure HTTP. Redirects are rejected; only
RSA signing keys with `use=sig`, `alg=RS256`, a valid thumbprint and at least
2048 bits are accepted. Refresh is single-flight with a bounded cooldown, so
random unknown `kid` values cannot amplify anonymous requests toward Auth.
Root Compose intentionally sets an empty JWKS URI and mounts the trusted Auth
public-key secret instead.

Required settings:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL targeting `schema=notification` |
| `KAFKA_BROKERS` | Comma-separated brokers when the consumer is enabled |
| `KAFKA_APPLICATION_TOPIC` | Defaults to `application-events` |
| `KAFKA_NOTIFICATION_GROUP_ID` | Dedicated v1 projection group |
| `KAFKA_INTERVIEW_TOPIC` | Defaults to `interview-events` |
| `KAFKA_NOTIFICATION_INTERVIEW_GROUP_ID` | Dedicated Interview v1 projection group |
| `NOTIFICATION_EVENT_MAX_BYTES` | Event cap, 1024–262144 bytes |
| `NOTIFICATION_APPLICATION_REPLAY_AFTER` | Required first-rollout UTC cutoff for retained Kafka record timestamps |
| `NOTIFICATION_INTERVIEW_REPLAY_AFTER` | Required stable Interview first-rollout UTC cutoff |
| `NOTIFICATION_CURSOR_HMAC_KEY` | Distinct non-placeholder secret, at least 32 bytes |
| `JWT_PUBLIC_KEY_PATH` or `JWT_PUBLIC_KEY` | Static Auth public key |
| `JWT_JWKS_URI` | Optional HTTPS JWKS alternative |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Canonical token claims |
| `CORS_ORIGINS` | Comma-separated exact browser origins |

Kafka is plaintext in the local Compose network. Production still requires
TLS/SASL, broker ACLs, secret rotation, lag/backlog/poison alerts and a
retention policy for processed and poison ledgers.

## Migration and tests

Use Node `>=24.15 <25`.

```bash
npm ci
export DATABASE_URL='postgresql://notification:notification@localhost:5432/notification?schema=notification'
npm run prisma:migrate:deploy
npm run build
npm run test:unit
```

The disposable full gate starts PostgreSQL 16 and Kafka 3.8, applies the
migration, runs unit and integration tests, then deploys the migration a second
time to prove idempotency:

```bash
docker compose -f compose.test.yml up \
  --build \
  --abort-on-container-exit \
  --exit-code-from notification-tests
docker compose -f compose.test.yml down -v --remove-orphans
```

The verified suite passes 51 unit tests and 7 PostgreSQL/Kafka integration
tests. Coverage includes bounded pre-start backlog delivery for both topics,
independent old-record cutoff/ledgering, duplicate/collision, poison
continuation, Interview payload privacy, legacy Application routing, DB
receive-time ordering, strict JWT/JWKS behavior, owner isolation, HMAC
pagination and cutoff read-all.
KafkaJS 2.2.4 can emit a Node 24 `TimeoutNegativeWarning`; it is an upstream
timer warning and does not change the passing delivery assertions.
