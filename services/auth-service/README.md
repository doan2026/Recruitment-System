# Auth Service

Spring Boot 3 / Java 21 service responsible for identity persistence and, in later tasks, registration, login, JWT RS256, Google OAuth2, OTP and password reset.

## Current status

The persistence foundation is implemented. Authentication endpoints and JWT issuance are not implemented yet, and `SecurityConfig` still permits every request until the security task replaces that scaffold.

Flyway migration `V1__create_auth_persistence.sql` creates these PostgreSQL tables in schema `auth`:

- `users`: UUID identity, canonical NFC/lowercase email, local bcrypt cost-10 hash (nullable for OAuth-only users), role, verification/lock audit state, timestamps and optimistic version. Self-registration accepts Candidate/Recruiter only; Google registration defaults to Candidate, while Admin requires a separate internal provisioning path.
- `refresh_sessions`: one row per refresh-token generation. Only a lowercase SHA-256 hash is stored. `family_id`, unique `parent_session_id`, `consumed_at`, revocation state and a composite parent FK preserve rotation lineage and prevent forked rotation.
- `oauth_accounts`: Google subject linkage with verified canonical provider email. Provider subject and `(user_id, provider)` are unique; Google access/refresh tokens are not stored.

Foreign keys use `ON DELETE RESTRICT`. Account deletion must explicitly revoke/retain sessions according to policy and unlink OAuth identities before deleting or anonymizing a user; JPA does not cascade-remove security history.

## OTP and password reset storage

OTP and password-reset secrets are intentionally not PostgreSQL tables. The architecture keeps them ephemeral in Redis:

- `otp:{normalizedEmail}`: one-time registration code, TTL 5 minutes.
- `otp:fail:{normalizedEmail}`: failed verification counter and temporary lock state.
- `otp:resend:{normalizedEmail}`: resend rate limit, at most three sends per hour.
- `reset:{opaqueToken}`: target user ID, TTL 15 minutes and deleted atomically after use.
- `login:fail:{normalizedEmail}`: failed-login counter and temporary lock state.

The registration/reset tasks must use atomic Redis consume operations and must never log or persist raw OTP, reset or refresh tokens.

## Refresh rotation contract

The future refresh workflow must execute in one transaction:

1. Hash the presented token with SHA-256, resolve its `user_id`, acquire that User through `findByIdForUpdate`, then refetch the session through `findByTokenHashForUpdate`. Every issue, rotate, logout, password-reset and admin-lock session mutation must use this same per-user aggregate lock.
2. Reject expired/revoked sessions. A previously `consumed_at` or revoked session is token reuse and requires revoking every active refresh session for that `user_id`; `family_id` remains lineage and detection metadata, not the revocation boundary.
3. For a valid token, mark the parent consumed and insert exactly one child with the same user/family and `parent_session_id` set to the parent.
4. Keep consumed/revoked rows at least until they can no longer be presented, so reuse remains detectable.

The per-user pessimistic lock serializes rotation against ancestor reuse and global revocation. Database unique/composite constraints remain the final guard against forked or cross-account lineage.

## Run tests

Unit tests:

```bash
docker run --rm \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/auth-service:/app" \
  -w /app \
  maven:3.9-eclipse-temurin-21 \
  mvn test
```

PostgreSQL 16 integration tests:

```bash
docker run --rm --network host \
  -e TESTCONTAINERS_HOST_OVERRIDE=localhost \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/recruitment-system-m2-cache:/root/.m2 \
  -v "$PWD/services/auth-service:/app" \
  -w /app \
  maven:3.9-eclipse-temurin-21 \
  mvn verify -Pintegration-test
```

The integration profile runs Flyway against a clean PostgreSQL 16 container, starts Hibernate with `ddl-auto=validate`, and verifies uniqueness, checks, foreign keys, optimistic locking and refresh lineage constraints.
