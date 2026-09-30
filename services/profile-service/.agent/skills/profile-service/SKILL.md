---
name: profile-service
description: Implement or review Candidate profile, consent, CV metadata and Media integration in the Recruitment System NestJS Profile Service.
---

# Profile Service

Use this skill for changes under `services/profile-service`. Profile owns Candidate profile and CV metadata in its PostgreSQL `profile` schema; it does not own identity, file bytes, or Application records.

## Working rules

- Before changing behavior, read this service README, the relevant Prisma schema/migrations/tests, `docs/architecture.md`, and `docs/person1-implementation.md`. Treat current API docs and event contracts as authoritative where the assignment text is older.
- Keep database ownership service-local. Identify users by the authenticated JWT subject; never add cross-service foreign keys or query another service's tables.
- Follow the existing NestJS/Prisma module, DTO validation, error-code, logging, and response conventions. For schema changes, create a forward migration and preserve upgrade safety for existing rows.
- Use the existing scoped internal-service identity and distinct API key for each internal contract. Do not accept a Recruiter bearer token as a substitute for service authorization.

## Data and CV invariants

- Candidate profile writes must remain owner-scoped, including every child lookup; defend against IDOR by scoping resource IDs to the authenticated owner.
- Preserve aggregate transactions, row locks, Serializable write behavior, bounded retry of serialization conflicts, and atomic `aggregateVersion` increments. Keep database constraints that mirror API invariants.
- Preserve CV revision immutability, revision-chain rules, active and retained quotas, exactly-one-default behavior when active CVs exist, and expected-version checks.
- A CV file reference is a verified Media `fileId`, never a client-supplied URL or trusted client metadata. Keep private download URLs short-lived and request-scoped. Do not place file URLs or CV content in Kafka events.
- Preserve the durable Application usage/deletion fence. Never physically delete a used or unfenced CV, and never weaken the gate to make a deletion request pass.
- Publish `cv-events` from the existing transactional outbox and use the current contract in `docs/architecture.md`; keep IDs, action, schema version and aggregate version consistent and events free of private file data.
- Keep consent flows explicit and independent. Do not infer job/recruiter discovery consent or a CV binding from profile fields, default CV, or application history.

## Verification

- For a code change run `npm run test:unit`; run `npm run test:integration` for database, migration, transaction, Media or CV lifecycle changes when PostgreSQL and required dependent services are available.
- Validate Prisma schema/migrations with the service's existing scripts. Add focused tests for meaningful behavior changes rather than restating the implementation.
- Update the service README/OpenAPI contract when an endpoint or cross-service behavior changes.