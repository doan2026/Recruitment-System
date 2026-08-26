# Auth Service

Spring Boot 3 / Java 21 service that owns user identities. PostgreSQL stores durable account/session data; Redis stores short-lived registration OTP state; SMTP delivers registration codes.

## Current status

The persistence foundation and Candidate/Recruiter email registration flow are implemented on the current feature branch. Registration uses bcrypt cost 10 and requires OTP verification before the account becomes verified.

Login, Google OAuth2, JWT RS256/JWKS, refresh-token rotation, password reset and Admin account controls remain pending. Security is stateless: only registration/OTP and health endpoints are public, while every other request is denied until its authentication flow is implemented.

Final test totals for this task: **77 unit tests + 16 PostgreSQL/Redis integration tests (93/93 passed)**.

## Registration API

All successful responses use `{ "data": ..., "meta": {} }`. Errors use `{ "code", "message", "details" }`; throttled responses also include `Retry-After` and `details.retryAfterSeconds`.

### Register

`POST /auth/register` returns HTTP `202 Accepted`.

```json
{
  "email": "candidate@example.com",
  "password": "Password1",
  "role": "CANDIDATE"
}
```

Only `CANDIDATE` and `RECRUITER` are accepted. A password must contain at least eight Unicode characters, at least one letter and one digit, and fit within bcrypt's 72 UTF-8 byte limit. The service stores only a bcrypt cost-10 hash.

```json
{
  "data": {
    "status": "OTP_REQUIRED",
    "expiresInSeconds": 300,
    "registrationId": "8c0f0f2a-bf2f-4bc1-af92-a214c010f24b"
  },
  "meta": {}
}
```

The client must retain `registrationId`. It identifies this specific pre-registration flow and is required for resend and verification.

Registering an already verified email returns `409 EMAIL_ALREADY_REGISTERED`. Registering an email that is still pending safely supersedes the old flow: password, role and `registrationId` are replaced together, and the previous OTP/flow can no longer verify the account. This prevents a stale or attacker-created pending registration from retaining credentials after the real owner starts a new flow.

### Resend OTP

`POST /auth/otp/resend` returns HTTP `202 Accepted`.

```json
{
  "email": "candidate@example.com",
  "registrationId": "8c0f0f2a-bf2f-4bc1-af92-a214c010f24b"
}
```

The response is deliberately generic for an unknown, verified or superseded flow:

```json
{
  "data": {
    "status": "OTP_SENT_IF_ELIGIBLE",
    "expiresInSeconds": 300
  },
  "meta": {}
}
```

An initial registration email does not consume the resend quota. At most three resends are accepted in a rolling one-hour window. A rejected request returns `429 OTP_RESEND_LIMITED` with `Retry-After`.

### Verify OTP

`POST /auth/otp/verify` returns HTTP `200 OK`.

```json
{
  "email": "candidate@example.com",
  "registrationId": "8c0f0f2a-bf2f-4bc1-af92-a214c010f24b",
  "otp": "123456"
}
```

```json
{
  "data": {
    "userId": "cb164285-23f6-487e-8028-2598011e86ec",
    "email": "candidate@example.com",
    "role": "CANDIDATE",
    "verified": true
  },
  "meta": {}
}
```

OTP verification activates the account only; it does not issue access or refresh tokens. Login and JWT issuance are the next Auth task. An invalid, expired or superseded flow receives the same `OTP_INVALID_OR_EXPIRED` response. The fifth wrong attempt deletes the active challenge and blocks verification/resend for 15 minutes.

## OTP safety and concurrency contract

- The raw six-digit OTP is sent by SMTP but is never stored in PostgreSQL or Redis and is never logged. Redis stores an HMAC-SHA-256 challenge with a random generation value, bound to purpose, stable user ID, `registrationId`, canonical email and code.
- Redis keys use an HMAC-derived email key rather than email PII. Challenge TTL is five minutes; failure block TTL is 15 minutes; resend quota is three in a rolling hour.
- Atomic Lua operations coordinate challenge installation, claim/finalize, failed attempts, rolling resend reservations and cleanup. A 30-second claim prevents two concurrent successful verifications.
- A renewable per-email Redis dispatch lease serializes registration/resend delivery. PostgreSQL also assigns every flow a monotonic `registration_fence`; a conditional upsert refuses an older fence, so an expired Redis lease cannot let a stale request overwrite newer pending credentials.
- The database rechecks user ID, `registrationId` and fence under a pessimistic lock before verification. A successful verification clears `registrationId`; its password and role are then fixed for later login.
- Redis or database availability failures fail closed. Cleanup is compare-and-delete/reservation-aware so an old request cannot delete a newer challenge.

SMTP delivery is synchronous. A success response means the SMTP client returned successfully, but SMTP does not provide an end-to-end exactly-once guarantee: a timeout or retry around the server acknowledgement can still cause delayed or duplicate email. Clients must treat the newest `registrationId` and OTP as authoritative.

## Persistence

Flyway manages schema `auth` and Hibernate runs with `ddl-auto=validate`:

- `V1__create_auth_persistence.sql` creates `users`, `refresh_sessions` and `oauth_accounts`.
- `V2__add_registration_flow_identity.sql` adds pending `registration_id`, a monotonic registration fence sequence/column, and database constraints for pending versus verified state.
- `users` stores canonical NFC/lowercase email, bcrypt cost-10 password hash for local accounts, role, verification/lock state, timestamps and optimistic version.
- `refresh_sessions` stores only lowercase SHA-256 token hashes with lineage and revocation state.
- `oauth_accounts` stores Google subject linkage and verified canonical provider email; Google access/refresh tokens are not stored.

Foreign keys use `ON DELETE RESTRICT`. Account deletion must explicitly revoke or retain session history and unlink OAuth identities before a user is deleted or anonymized.

## Refresh rotation contract

The future refresh workflow must execute in one transaction:

1. Hash the presented token with SHA-256, resolve its user, lock that User through `findByIdForUpdate`, then refetch the session through `findByTokenHashForUpdate`. Issue, rotate, logout, password-reset and Admin-lock session mutations must use the same per-user aggregate lock.
2. Reject expired/revoked sessions. A consumed or revoked token is reuse and requires revoking every active refresh session for the user; `family_id` is lineage metadata, not the revocation boundary.
3. For a valid token, mark the parent consumed and insert exactly one child with the same user/family and `parent_session_id` set to the parent.
4. Retain consumed/revoked rows until they can no longer be presented so reuse remains detectable.

## Configuration

Required registration settings are documented in `.env.example`:

- `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `REDIS_URL` (production Compose uses authenticated Redis)
- `OTP_HMAC_SECRET`, at least 32 UTF-8 bytes and generated as a high-entropy secret
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_AUTH`
- `SMTP_STARTTLS`, `SMTP_STARTTLS_REQUIRED`

For production SMTP, set both `SMTP_STARTTLS=true` and `SMTP_STARTTLS_REQUIRED=true`, use authenticated SMTP, and manage all credentials through a secret store. Development defaults intentionally do not claim transport security.

SMTP connect/read/write timeouts are three seconds. OTP lifetime, attempt block, resend window, claim TTL and dispatch lease are configured under `auth.otp` in `application.yml`.

## Health endpoints

- Direct service: `GET /health`, `GET /auth/health` or `GET /actuator/health`
- Through API Gateway: `GET /auth/health`

The public health aliases proxy the real Actuator health aggregate. `DOWN` or `OUT_OF_SERVICE` returns HTTP `503`; healthy/degraded non-terminal states return `200`. Health details are not exposed.

## Run tests

Unit tests:

```bash
docker run --rm \
  -e OTP_HMAC_SECRET=test-hmac-secret-that-is-at-least-32-bytes \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/auth-service:/app" \
  -w /app \
  maven:3.9-eclipse-temurin-21 \
  mvn test
```

PostgreSQL 16 and Redis 7 integration tests:

```bash
docker run --rm --network host \
  -e TESTCONTAINERS_HOST_OVERRIDE=localhost \
  -e OTP_HMAC_SECRET=test-hmac-secret-that-is-at-least-32-bytes \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/auth-service:/app" \
  -w /app \
  maven:3.9-eclipse-temurin-21 \
  mvn verify -Pintegration-test
```

The integration profile validates Flyway/Hibernate on clean PostgreSQL 16 plus real authenticated Redis 7 behavior, including OTP expiry/rate limits, safe flow supersession, database fencing and concurrent verification. The final run passed **77/77 unit tests and 16/16 integration tests (93/93 total)** with PostgreSQL 16.15, authenticated Redis 7 and Testcontainers 1.21.4.
