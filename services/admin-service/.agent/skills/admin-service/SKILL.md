---
name: admin-service
description: Implement or review Admin moderation, reports, audit and statistics in the Recruitment System Spring Boot Admin Service.
---

# Admin & Statistics Service

Use this skill for changes under `services/admin-service`. Admin owns moderation workflow, reports, audit records and derived statistics in the `admin` schema. It must not read or write another service's database.

## Working rules

- Read the Admin README, current code/tests, Flyway migrations, `docs/architecture.md`, and `docs/person1-implementation.md` before changing behavior. Use current upstream endpoint and Kafka contracts rather than assuming the assignment's planned contract is already available.
- Keep the existing Spring Boot 3 / Java 21 layering, JDBC/Flyway schema ownership, validation and response conventions. Require schema migrations for persistence changes; never rewrite already-applied migrations.
- Authenticate RS256 JWTs with the configured JWKS, issuer, audience and required claims. Before privileged operations, retain the durable Admin-state check through Auth; fail closed if it cannot be confirmed.
- Call only configured service origins. Forward the user's bearer token only to the intended upstream service; never accept a caller-selected URL or log bearer tokens/internal keys.

## Moderation, audit and report invariants

- Persist an append-only `STARTED` audit record before a remote moderation mutation, then append its terminal result. Preserve actor, target, reason, operation identity and UTC time; do not update/delete audit history.
- Treat timeout or upstream outage as ambiguous (`UNKNOWN`), not success or definite failure. Do not blindly retry a moderation mutation; reconcile upstream state before a human retries.
- Preserve report row locking and `expectedVersion` compare-and-set. A report becomes `RESOLVED` only after the owning service confirms the action. If no upstream takedown contract exists, keep the explicit unavailable outcome; do not fake resolution.
- Keep `DISMISSED` free of remote mutation and preserve current behavior for definite upstream rejection versus ambiguous failure.

## Statistics invariants

- Consume only the event schemas documented for the existing `job-events` and `application-events` topics. Preserve `event_id` idempotency, event ordering/version handling, malformed-event quarantine without retaining payload, and retry without acknowledging lost records.
- Maintain dirty-day recomputation for late/out-of-order data. Do not count draft jobs as published, or double-count application stages such as offer events.
- Preserve the documented funnel cohort and date bounds. Metrics without an approved source event remain unavailable; do not infer or fabricate new-user/new-company counts.
- Keep exports bounded to the documented daily metric range/row limits and escape CSV/XLSX output appropriately.

## Verification

- Add focused JUnit tests for access control, ambiguous upstream failures, audit immutability, idempotency and metric semantics when affected.
- Run `mvn test`; run `mvn -Pintegration -Dapi.version=1.44 verify` for PostgreSQL/Flyway, transaction, concurrency or application-startup changes when Docker is available.
- Update Admin README/OpenAPI and relevant contract docs when public routes, upstream behavior or event semantics change.