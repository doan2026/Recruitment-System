# Profile Service

NestJS/Prisma service that owns Candidate profile data and CV metadata in the PostgreSQL `profile` schema.

## Persistence implemented

- `Profile` is keyed internally by UUID and has a unique external Auth `user_id`; no cross-service database foreign key is used.
- Owned `Education`, `Experience`, `Skill`, `Certificate`, and `Project` rows cascade with the profile.
- `Cv` references `Profile.user_id` with `ON DELETE RESTRICT`, stores upload/online-builder metadata, a schema version, aggregate version, default/deleted state, and first-use marker.
- A partial unique index allows at most one active default CV per Candidate.
- Once `first_used_at` is set, CV file and content form an immutable revision. Editing a used Online CV must clone its content into a new CV/revision ID; an unused CV may still be edited in place. All hard deletes currently fail closed until Application can provide authoritative usage evidence.

Database constraints validate percentages, dates, normalized skills, HTTPS URLs, builder JSON size/shape, and CV delete/default/identity state.

## Run locally

```bash
npm ci
export DATABASE_URL='postgresql://profile:profile@localhost:5432/recruitment?schema=profile'
npm run prisma:migrate:deploy
npm run build
npm run start
```

Run migrations as a separate deployment job with a dedicated DDL-capable migrator role. `npm run start:prod` only starts the compiled service so its runtime database role can remain DML-only; the production image runs as the non-root `node` user.

## PostgreSQL integration test

The Docker suite builds the service test target, applies the migration to PostgreSQL 16, exercises real constraints/relations/JSONB/CV revision behavior, and runs `prisma migrate deploy` a second time to prove there are no pending migrations:

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from profile-tests
docker compose -f compose.test.yml down -v
```

## Deliberately pending P08 work

- CRUD, completion calculation, JWT/role authorization, validation, Swagger, and internal CV APIs.
- Media Service ownership/type/status verification. `file_url` must be a canonical HTTPS URL returned by Media, never a client-provided or short-lived signed URL.
- The maximum-five-CV rule, default handover, and version increment must lock the Profile row and execute in one transaction; the partial index is the final database guard for concurrent defaults.
- Marking a CV as used must be coordinated with Application Service. Until that contract exists, the database blocks every hard delete and only soft delete should be exposed; unused-only hard delete remains pending.
- The edit API/UI must make the revision behavior explicit: reopening a used Online CV creates a new `cv_id`, preserving exactly what Application referenced; default selection may then move to the new revision transactionally.
- Canonical versioned `cv-events` contract, transactional writer, publisher/retry/retention, and AI consumer integration.
- Separate PostgreSQL role grants so Profile PII is inaccessible to other service roles. The image supports a separate migration job, but repository-wide grants are still pending.
- Root Compose currently follows the repository's shared-PostgreSQL/schema-per-service layout. This is an explicit deviation from the architecture document's separate `profile-db` database/container and must be resolved or formally accepted before production.
- `aggregate_version` compare-and-set/monotonic updates, max-five enforcement, exact-one-default handover, and atomic CV+event-intent writes belong to later service/event tasks and are not claimed here.
