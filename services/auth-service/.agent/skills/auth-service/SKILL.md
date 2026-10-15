---
name: auth-service
description: Implement or review the Recruitment System Auth Service (Spring Boot/Java), including identity, OTP, sessions, JWT, password recovery and admin account controls.
---

# Auth Service

Use this skill for changes under `services/auth-service`. Treat this service as the sole owner and issuer of user identity and RS256 access tokens.

## Working rules

- Read the relevant Auth README, current implementation/tests, root `docs/architecture.md`, and `docs/person1-implementation.md` before changing a contract. The assignment document describes business intent; the current API and architecture documents define the implemented cross-service contract. If they differ, preserve the current contract unless the user explicitly asks to change it, then update affected docs and tests together.
- Keep changes within Auth and its owned data. Do not make another service read Auth tables or take on responsibilities that belong to Profile, Media or Admin.
- Follow the existing Spring Boot 3 / Java 21 layering, Spring Security, JPA, Redis, validation and error-response conventions. Preserve `{data, meta}` success responses and stable `{code, message, details}` errors.

## Security and behavior invariants

- Auth alone signs JWTs. Use RS256, a `kid`, the configured issuer/audience and the configured key paths. Never expose or copy the private key to another service, log credentials/tokens/OTP/reset secrets, or commit secret values.
- Store passwords using the existing bcrypt policy and refresh-token hashes, never raw passwords or refresh tokens. Keep access-token claims limited to the established cross-service contract.
- Preserve the registration flow's `registrationId` binding, OTP expiry/one-time use, resend/failure throttles, and safe replacement of pending registrations. Do not simplify OTP handling to email-only matching.
- Preserve non-enumerating login/recovery behavior, verified/locked account checks, refresh rotation and token-reuse response, and reset-triggered session revocation.
- OAuth linking and role behavior must follow the current implementation's explicit account-link safeguards. Do not auto-link accounts solely because email strings match.
- `/auth/me` and administrative account actions must use durable account state. Locking must revoke refresh sessions as implemented; stale token claims are not sufficient authorization for account control.

## Verification

- Add or update focused JUnit tests for changed behavior, including security and failure cases where relevant.
- Run `mvn test` from this service. Run the documented PostgreSQL/Redis integration profile when a change touches persistence, locking, migrations, OTP/session storage or transaction behavior and the required local infrastructure is available.
- Keep OpenAPI and Postman handoff contracts aligned when public or internal endpoints change.