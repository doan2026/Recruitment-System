# Profile Service

NestJS/Prisma service that owns Candidate profile data and CV metadata in the PostgreSQL `profile` schema.

## Persistence implemented

- `Profile` is keyed internally by UUID and has a unique external Auth `user_id`; no cross-service database foreign key is used.
- Owned `Education`, `Experience`, `Skill`, `Certificate`, and `Project` rows cascade with the profile.
- `Cv` references `Profile.user_id` with `ON DELETE RESTRICT`, stores upload/online-builder metadata, a schema version, aggregate version, default/deleted state, and first-use marker.
- A partial unique index allows at most one active default CV per Candidate.
- Once `first_used_at` is set, CV file and content form an immutable revision. Editing a used Online CV must clone its content into a new CV/revision ID; an unused CV may still be edited in place. All hard deletes currently fail closed until Application can provide authoritative usage evidence.

Database constraints validate percentages, dates, normalized skills, HTTPS URLs, builder JSON size/shape, and CV delete/default/identity state.

## Candidate profile API implemented

- Through the gateway, the base path is `/profile`; direct service paths omit that prefix. General fields use `GET /profile/:userId` and `PUT /profile/:userId`.
- Education, experience, skill, certificate, and project blocks support `POST`, `PUT /:id`, and `DELETE /:id`. Plural resource paths are canonical (`educations`, `experiences`, `skills`, `certificates`, `projects`); singular aliases remain available for the source specification.
- Per-Profile limits are enforced after locking the aggregate in the same transaction: 20 educations, 30 experiences, 100 skills, 50 certificates, and 50 projects. Exceeding a limit returns `409 PROFILE_COLLECTION_LIMIT_REACHED`.
- General `PUT` is a merge update, not full replacement. The first general or child write lazily creates the Profile aggregate.
- Candidate access is owner-only. Child lookups are scoped by both child ID and the authenticated Candidate's Profile to prevent IDOR. Recruiter-related reads remain fail-closed until Application/Company authorization evidence has a versioned contract.
- JWT verification requires RS256, `typ=JWT`, RFC 7638 `kid`, issuer, audience, UUID v4 `sub/jti`, a known role, integer `iat/exp`, `exp > iat`, expiration validation, and no `iat` more than 60 seconds in the future. JWKS requires HTTPS by default and rejects redirects; HTTP needs the explicit development-only `JWT_ALLOW_INSECURE_JWKS=true` opt-in. The repository Root Compose opts in for local development only. Static PEM is an alternative verification source when `JWT_JWKS_URI` is absent, not failover for a broken JWKS endpoint.
- Validation rejects unknown fields and wrong JSON types, trims text, canonicalizes HTTPS URLs, validates real calendar dates and block invariants, and returns stable error codes. Swagger is available at `/profile/docs` through the gateway or `/docs` directly in development; production disables it unless `SWAGGER_ENABLED=true` is set intentionally.
- Every mutation runs at Serializable isolation, locks the Profile row, retries PostgreSQL serialization failures (including raw-query SQLSTATE `40001`) up to eight times with bounded exponential jitter, persists completion, and increments `aggregateVersion` atomically. Aggregate reads use a Repeatable Read snapshot.

### Completion rule v1

| Criterion | Weight |
| --- | ---: |
| Full name | 10 |
| Headline | 5 |
| Summary | 5 |
| Phone | 5 |
| Address | 5 |
| At least one GitHub, LinkedIn, or portfolio link | 5 |
| At least one education | 15 |
| At least one experience | 20 |
| At least one skill | 20 |
| At least one certificate | 5 |
| At least one project | 5 |

Each criterion contributes at most once, for a maximum of 100. Responses include `completionPercent`, `completionRuleVersion=1`, and `missingSections`; a non-blocking warning is returned only below 50%. Avatar is intentionally excluded until Media ownership/type/status verification exists. The migration transactionally backfills persisted scores for existing profiles before rule v1 is claimed.

## Run locally

```bash
npm ci
export DATABASE_URL='postgresql://profile:profile@localhost:5432/recruitment?schema=profile'
export JWT_JWKS_URI='http://localhost:8080/auth/.well-known/jwks.json'
export JWT_ALLOW_INSECURE_JWKS='true'
export JWT_ISSUER='https://auth.recruitment.local'
export JWT_AUDIENCE='recruitment-api'
export CORS_ORIGINS='http://localhost:3000'
export SWAGGER_ENABLED='true'
npm run prisma:migrate:deploy
npm run build
npm run start
```

Run migrations as a separate deployment job with a dedicated DDL-capable migrator role. `npm run start:prod` only starts the compiled service so its runtime database role can remain DML-only; the production image runs as the non-root `node` user.

## PostgreSQL integration test

The Docker suite first applies the original migration, seeds a whitespace-bearing legacy Profile, and proves the completion migration backfills it from a stale 7% to the expected 50%/rule v1. It then deploys both migrations to a clean PostgreSQL 16 instance, runs 8 unit tests and 23 integration tests, and deploys migrations a second time to prove there are no pending changes. Destructive test scripts fail before `DROP/TRUNCATE` unless `ALLOW_PROFILE_SCHEMA_RESET=true` and the database name ends in `_test`. Coverage includes real constraints/relations/JSONB/CV revision behavior, strict JWT failures, validation/IDOR for all child types, OpenAPI contracts, collection caps, Unicode normalization, completion persistence, route aliases, and concurrent first/existing/burst Profile writes:

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from profile-tests
docker compose -f compose.test.yml down -v
```

## Deliberately pending P08 work

- Internal CV APIs and recruiter-related Profile reads. Candidate CRUD/auth/completion/Swagger are implemented; recruiter access stays fail-closed until Company/Application evidence is defined.
- Media Service ownership/type/status verification. `file_url` must be a canonical HTTPS URL returned by Media, never a client-provided or short-lived signed URL.
- The maximum-five-CV rule, default handover, and version increment must lock the Profile row and execute in one transaction; the partial index is the final database guard for concurrent defaults.
- Marking a CV as used must be coordinated with Application Service. Until that contract exists, the database blocks every hard delete and only soft delete should be exposed; unused-only hard delete remains pending.
- The edit API/UI must make the revision behavior explicit: reopening a used Online CV creates a new `cv_id`, preserving exactly what Application referenced; default selection may then move to the new revision transactionally.
- Canonical versioned `cv-events` contract, transactional writer, publisher/retry/retention, and AI consumer integration.
- Separate PostgreSQL role grants so Profile PII is inaccessible to other service roles. The image supports a separate migration job, but repository-wide grants are still pending.
- Root Compose currently follows the repository's shared-PostgreSQL/schema-per-service layout. This is an explicit deviation from the architecture document's separate `profile-db` database/container and must be resolved or formally accepted before production.
- Candidate Profile `aggregate_version` is now monotonic and transactional. CV compare-and-set, max-five enforcement, exact-one-default handover, and atomic CV+event-intent writes belong to later service/event tasks.
- Distributed per-user/ingress rate limiting remains production hardening; collection rows are now transactionally bounded, but request frequency still needs a shared gateway/WAF policy for multi-replica production.
