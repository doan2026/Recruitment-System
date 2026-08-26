# Auth Service

Spring Boot 3 / Java 21 service that owns user identities. PostgreSQL stores durable account/session data; Redis stores short-lived registration OTP and password-reset state; SMTP delivers registration codes and reset links.

## Current status

Candidate/Recruiter registration, OTP verification, password login, Google OIDC, JWT RS256/JWKS, refresh-token rotation, logout, password reset and `GET /auth/me` are implemented. A successful OTP verification signs the user in and returns the same local token pair as password and Google login.

The internal Admin lock/unlock API remains pending. Security is stateless and deny-by-default; only health, registration, login/token, password-recovery and Google handshake endpoints are public. Every protected request uses a locally verified access JWT, while `/auth/me` additionally checks the current durable account state.

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
    "accessToken": "eyJ...",
    "tokenType": "Bearer",
    "accessTokenExpiresInSeconds": 900,
    "refreshToken": "rt1_...",
    "refreshTokenExpiresInSeconds": 604800,
    "user": {
      "id": "cb164285-23f6-487e-8028-2598011e86ec",
      "email": "candidate@example.com",
      "role": "CANDIDATE"
    }
  },
  "meta": {}
}
```

OTP verification activates the account, then creates a local refresh family. These are separate database transactions: if token issuance fails after verification, the account remains verified and password login is the recovery path. An invalid, expired or superseded flow receives the same `OTP_INVALID_OR_EXPIRED` response. The fifth wrong attempt deletes the active challenge and blocks verification/resend for 15 minutes. Token-bearing responses use `Cache-Control: no-store`.

## OTP safety and concurrency contract

- The raw six-digit OTP is sent by SMTP but is never stored in PostgreSQL or Redis and is never logged. Redis stores an HMAC-SHA-256 challenge with a random generation value, bound to purpose, stable user ID, `registrationId`, canonical email and code.
- Redis keys use an HMAC-derived email key rather than email PII. Challenge TTL is five minutes; failure block TTL is 15 minutes; resend quota is three in a rolling hour.
- Atomic Lua operations coordinate challenge installation, claim/finalize, failed attempts, rolling resend reservations and cleanup. A 30-second claim prevents two concurrent successful verifications.
- A renewable per-email Redis dispatch lease serializes registration/resend delivery. PostgreSQL also assigns every flow a monotonic `registration_fence`; a conditional upsert refuses an older fence, so an expired Redis lease cannot let a stale request overwrite newer pending credentials.
- The database rechecks user ID, `registrationId` and fence under a pessimistic lock before verification. A successful verification clears `registrationId`; its password and role are then fixed for later login.
- Redis or database availability failures fail closed. Cleanup is compare-and-delete/reservation-aware so an old request cannot delete a newer challenge.

SMTP delivery is synchronous. A success response means the SMTP client returned successfully, but SMTP does not provide an end-to-end exactly-once guarantee: a timeout or retry around the server acknowledgement can still cause delayed or duplicate email. Clients must treat the newest `registrationId` and OTP as authoritative.

## Password login

`POST /auth/login` accepts canonicalized email and a password:

```json
{
  "email": "candidate@example.com",
  "password": "Password1"
}
```

A verified, unlocked local account receives the token response shown above. Unknown email, wrong password and an OAuth-only account all return the same `401 INVALID_CREDENTIALS`; the unknown/OAuth-only paths still execute a cost-10 dummy bcrypt check. A pending account returns `403 EMAIL_NOT_VERIFIED` with only its `registrationId`. A locked account returns generic `403 ACCOUNT_LOCKED` and does not expose the internal moderation reason.

Redis Lua tracks failures atomically under HMAC-derived, PII-free keys. The fifth consecutive failure starts a 15-minute block and returns `429 LOGIN_TEMPORARILY_BLOCKED` with `Retry-After`. A successful credential clears the failure state. Redis failure is fail-closed as `503 LOGIN_RATE_LIMIT_UNAVAILABLE`.

## Forgot and reset password

`POST /auth/forgot-password` accepts `{ "email": "candidate@example.com" }`. At service level, every syntactically valid email receives the same non-cacheable HTTP `202 Accepted` response unless the initial quota reservation or account lookup is unavailable. The API gateway can reject excessive traffic first with generic HTTP `429`:

```json
{
  "data": {
    "status": "RESET_EMAIL_SENT_IF_ELIGIBLE",
    "expiresInSeconds": 900
  },
  "meta": {}
}
```

Only a verified account with a local password receives mail. Unknown, pending and OAuth-only accounts are generic no-ops. A locked local account may reset its password but remains locked. Requests use an HMAC-derived, PII-free rolling quota of three per email per hour; limited requests deliberately return the same response. The gateway separately limits password-recovery `POST` traffic to 10 requests/minute per client IP (burst 5) and 20 requests/second per gateway instance (burst 40), returns a generic allowlisted-CORS `429` with `Retry-After`, and does not charge non-`POST`/preflight traffic. Eligible delivery is queued on a bounded executor so SMTP latency does not directly distinguish an existing email. The newest successfully installed token supersedes the older token; a request while the previous token has an active delivery/claim lease is a generic no-op. The configured frontend link carries the token only in the URL fragment (`#token=...`).

`POST /auth/reset-password` accepts:

```json
{
  "token": "pr1_...",
  "newPassword": "Password2"
}
```

A successful reset returns HTTP `204 No Content`. Malformed, missing, expired, superseded and replayed tokens all return `400 RESET_TOKEN_INVALID_OR_EXPIRED`. The new password follows the registration policy and is stored as bcrypt cost 10.

Reset tokens contain 256 random bits. A raw token exists transiently in the bounded delivery task, email/link and reset request; it is never returned by the forgot API, persisted or logged. Redis stores an HMAC digest under HMAC-derived email/user keys for 15 minutes. Lua coordinates exact reservation rollback, latest-token installation, mail-delivery lease, one-time claim, recovery and CAS finalization. Each challenge is bound to the User ID and optimistic version, so a token cannot change the password twice even if post-commit Redis cleanup fails.

Password update and revocation of every active refresh session use one PostgreSQL transaction with User-first locking. Existing `ROTATED`, `LOGOUT` or expired audit rows are preserved. A successful reset also clears temporary password-login failures. Existing stateless access JWTs are not introspected and can remain valid for at most their 15-minute lifetime. Forgot quota-reservation/account-lookup failures and reset claim/transaction failures return `503 PASSWORD_RESET_UNAVAILABLE`; an account-specific install failure instead rolls back its reservation and keeps the generic `202`. Asynchronous SMTP or post-commit cleanup failure keeps the generic response, and failed delivery CAS-discards the undelivered challenge.

Compose publishes only the gateway, so the per-IP limiter sees clients directly in the default topology. A deployment behind a trusted load balancer/CDN must configure Nginx Real IP with the trusted proxy CIDRs. The gateway recovery CORS map must stay synchronized with `CORS_ORIGINS`, and a horizontally replicated gateway must use a distributed ingress/WAF limiter when a deployment-wide cap is required.

## Google OIDC login

1. Navigate the browser to `GET /auth/google`.
2. The service creates state, nonce and PKCE S256 verifier material, stores the serialized authorization request in Redis, and redirects to Google.
3. Spring Security validates the callback and OIDC ID token. Provider access/refresh tokens are never persisted or returned.
4. The success redirect contains only `#code=<one-time-code>` and sets a short-lived HttpOnly binder cookie.
5. The frontend calls `POST /auth/google/exchange` with `{ "code": "...", "role": "CANDIDATE" }` and `credentials: "include"`. `role` is optional and is used only when creating a new account; allowed values are `CANDIDATE` and `RECRUITER`.

The Redis exchange consumes the code and matching binder exactly once. Google `sub` is the durable provider identity. An already linked subject signs in to its linked user; a new subject with a new verified email creates an OAuth-only user. An existing but unlinked email returns `409 ACCOUNT_LINK_REQUIRED` instead of being auto-linked by email. A future account-link flow must require fresh authentication to the existing account.

The binder cookie is `SameSite=Lax`; therefore production frontend and Auth URLs must be HTTPS and on the same schemeful site (for example `app.example.com` and `auth.example.com`). The frontend origin must also be listed exactly in `CORS_ORIGINS`.

## Access JWT, JWKS and current account

Access tokens are RS256 JWTs with standard `typ=JWT`, a deterministic public-key thumbprint `kid`, and exactly these claims: `iss`, UUID `sub`, `aud`, `role`, `iat`, `exp` and UUID `jti`. Lifetime is 15 minutes. Email/profile data is deliberately excluded.

- `GET /auth/.well-known/jwks.json` publishes active and configured previous RSA public keys only (`kty`, `use`, `alg`, `kid`, `n`, `e`).
- `GET /auth/me` requires `Authorization: Bearer <access-token>` and returns current `id`, `email`, `role` and verification state after rechecking PostgreSQL. Deleted, unverified or locked accounts are rejected.
- The decoder accepts only `RS256`, standard `typ=JWT`, a known non-empty `kid`, configured issuer/audience, UUID `sub`/`jti` and one of `CANDIDATE`, `RECRUITER`, `ADMIN`.

## Refresh and logout API

`POST /auth/refresh` and `POST /auth/logout` accept:

```json
{ "refreshToken": "rt1_..." }
```

Refresh returns a new access/refresh pair. Logout returns `204`. The raw refresh token is 256 random bits with an `rt1_` prefix; PostgreSQL stores only its SHA-256 hash. All token responses and token-related errors are non-cacheable.

## Persistence

Flyway manages schema `auth` and Hibernate runs with `ddl-auto=validate`:

- `V1__create_auth_persistence.sql` creates `users`, `refresh_sessions` and `oauth_accounts`.
- `V2__add_registration_flow_identity.sql` adds pending `registration_id`, a monotonic registration fence sequence/column, and database constraints for pending versus verified state.
- `users` stores canonical NFC/lowercase email, bcrypt cost-10 password hash for local accounts, role, verification/lock state, timestamps and optimistic version.
- `refresh_sessions` stores only lowercase SHA-256 token hashes with lineage and revocation state.
- `oauth_accounts` stores Google subject linkage and verified canonical provider email; Google access/refresh tokens are not stored.

Foreign keys use `ON DELETE RESTRICT`. Account deletion must explicitly revoke or retain session history and unlink OAuth identities before a user is deleted or anonymized.

## Refresh rotation contract

Refresh and logout execute under one per-user transaction: resolve only the user ID from the token hash, pessimistically lock the User aggregate, then lock/refetch the session. This ordering prevents two concurrent requests from forking a refresh family.

- A valid refresh marks the parent `ROTATED` and inserts exactly one child with the same user, family and absolute expiry.
- A refresh family expires seven days after initial login; rotation is not sliding. A token rotated on day six therefore has about one day remaining, as reported by `refreshTokenExpiresInSeconds`.
- Replay of a consumed/revoked token while its family is still live revokes every active session for that user. This includes the child won by a competing concurrent refresh.
- Expiry is checked before reuse. Replaying an old token after the family lifetime returns the generic invalid response but cannot revoke a newer family.
- Expired, consumed and revoked rows remain durable audit/reuse evidence. `family_id` is lineage metadata; active-session revocation is user-wide.

## Configuration

Required settings are documented in `.env.example`:

- `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `REDIS_URL` (production Compose uses authenticated Redis)
- `OTP_HMAC_SECRET`, at least 32 UTF-8 bytes and generated as a high-entropy secret
- `LOGIN_HMAC_SECRET`, a different high-entropy secret of at least 32 UTF-8 bytes
- `PASSWORD_RESET_HMAC_SECRET`, another independent high-entropy secret of at least 32 UTF-8 bytes
- `PASSWORD_RESET_FRONTEND_URI`, the fixed reset page; production must use HTTPS and the URI cannot contain query, fragment or user info
- `JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`, `JWT_ISSUER`, `JWT_AUDIENCE`
- `JWT_PREVIOUS_PUBLIC_KEY_PATHS`, a comma-separated set of old public keys during key rotation
- `CORS_ORIGINS`, a comma-separated exact HTTPS origin allowlist; HTTP is accepted only for loopback development
- `GOOGLE_OAUTH_ENABLED`, Google client credentials, fixed callback/frontend redirect URIs and `GOOGLE_SECURE_COOKIES`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_AUTH`
- `SMTP_STARTTLS`, `SMTP_STARTTLS_REQUIRED`

For production SMTP, set both `SMTP_STARTTLS=true` and `SMTP_STARTTLS_REQUIRED=true`, use authenticated SMTP, and manage all credentials through a secret store. Development defaults intentionally do not claim transport security. SMTP connect/read/write timeouts are three seconds.

Run `./scripts/generate-jwt-keys.sh` from the repository root before Docker Compose. It creates an unencrypted PKCS#8 RSA-3072 private key and X.509 public key under the Git-ignored `secrets/` directory and refuses to overwrite existing keys. Compose mounts the private key only into Auth and the public key into JWT-consuming services.

For rotation, mount the old public key separately and list its container path in `JWT_PREVIOUS_PUBLIC_KEY_PATHS`. Keep both public keys deployed for at least the 15-minute access-token lifetime plus deployment/clock-skew margin, then remove the old key. Never retain or distribute the old private key.

## Health endpoints

- Direct service: `GET /health`, `GET /auth/health` or `GET /actuator/health`
- Through API Gateway: `GET /auth/health`

The public health aliases proxy the real Actuator health aggregate. `DOWN` or `OUT_OF_SERVICE` returns HTTP `503`; healthy/degraded non-terminal states return `200`. Health details are not exposed.

## Run tests

Unit tests:

```bash
docker run --rm \
  -e LOGIN_HMAC_SECRET=test-login-secret-that-is-at-least-32-bytes \
  -e OTP_HMAC_SECRET=test-hmac-secret-that-is-at-least-32-bytes \
  -e PASSWORD_RESET_HMAC_SECRET=test-password-reset-secret-that-is-at-least-32-bytes \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/auth-service:/app" \
  -w /app \
  maven:3.9-eclipse-temurin-21 \
  mvn clean test
```

PostgreSQL 16 and Redis 7 integration tests:

```bash
docker run --rm --network host \
  -e TESTCONTAINERS_HOST_OVERRIDE=localhost \
  -e OTP_HMAC_SECRET=test-hmac-secret-that-is-at-least-32-bytes \
  -e LOGIN_HMAC_SECRET=test-login-secret-that-is-at-least-32-bytes \
  -e PASSWORD_RESET_HMAC_SECRET=test-password-reset-secret-that-is-at-least-32-bytes \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/auth-service:/app" \
  -w /app \
  maven:3.9-eclipse-temurin-21 \
  mvn clean verify -Pintegration-test
```

The integration profile validates Flyway/Hibernate on clean PostgreSQL 16 plus authenticated Redis 7: OTP fencing/rate limits, Google exchange exactly-once, password throttling, password-reset privacy/quota/TTL/supersession/transactions/concurrency, JWT/JWKS and `/auth/me`, refresh lineage/reuse/expiry/concurrency, CORS and fail-closed outages. The final clean run passed **195/195 unit tests and 35/35 integration tests (230/230 total)** with PostgreSQL 16.15, Redis 7 and Testcontainers 1.21.4. The gateway configuration also passes `nginx -t`.
