# Profile Service

NestJS/Prisma service that owns Candidate profile data and CV metadata in the PostgreSQL `profile` schema.

## Persistence implemented

- `Profile` is keyed internally by UUID and has a unique external Auth `user_id`; no cross-service database foreign key is used.
- Owned `Education`, `Experience`, `Skill`, `Certificate`, and `Project` rows cascade with the profile.
- `Cv` references `Profile.user_id` with `ON DELETE RESTRICT`, stores upload/online-builder metadata, a schema version, aggregate version, default/deleted state, and first-use marker. New uploaded CVs store an immutable Media reference and no public URL; the nullable `file_url` column remains only for legacy compatibility.
- A partial unique index allows at most one active default CV per Candidate.
- Once `first_used_at` is set, CV file and content form an immutable revision. Editing a used Online CV must clone its content into a new CV/revision ID; an unused CV may still be edited in place. Application now owns a durable usage ledger and lookup API, but all hard deletes remain fail-closed because a separate lookup followed by delete has a TOCTOU race; a deletion fence/reservation contract is still required.

Database constraints validate percentages, dates, normalized skills, HTTPS URLs, builder JSON size/shape, and CV delete/default/identity state.

## Candidate profile API implemented

- Through the gateway, the base path is `/profile`; direct service paths omit that prefix. General fields use `GET /profile/:userId` and `PUT /profile/:userId`.
- Education, experience, skill, certificate, and project blocks support `POST`, `PUT /:id`, and `DELETE /:id`. Plural resource paths are canonical (`educations`, `experiences`, `skills`, `certificates`, `projects`); singular aliases remain available for the source specification.
- Per-Profile limits are enforced after locking the aggregate in the same transaction: 20 educations, 30 experiences, 100 skills, 50 certificates, and 50 projects. Exceeding a limit returns `409 PROFILE_COLLECTION_LIMIT_REACHED`.
- General `PUT` is a merge update, not full replacement. The first general or child write lazily creates the Profile aggregate.
- Candidate access is owner-only. Child lookups are scoped by both child ID and the authenticated Candidate's Profile to prevent IDOR. Recruiters never call Profile directly: Application authorizes Company membership and Application ownership first, then uses the internal exact-revision contract without forwarding the Recruiter JWT.
- JWT verification requires RS256, `typ=JWT`, RFC 7638 `kid`, issuer, audience, UUID v4 `sub/jti`, a known role, integer `iat/exp`, `exp > iat`, expiration validation, and no `iat` more than 60 seconds in the future. JWKS requires HTTPS by default and rejects redirects; HTTP needs the explicit development-only `JWT_ALLOW_INSECURE_JWKS=true` opt-in. The repository Root Compose opts in for local development only. Static PEM is an alternative verification source when `JWT_JWKS_URI` is absent, not failover for a broken JWKS endpoint.
- Validation rejects unknown fields and wrong JSON types, trims text, canonicalizes HTTPS URLs, validates real calendar dates and block invariants, and returns stable error codes. Swagger is available at `/profile/docs` through the gateway or `/docs` directly in development; production disables it unless `SWAGGER_ENABLED=true` is set intentionally.
- Every mutation runs at Serializable isolation, locks the Profile row, retries PostgreSQL serialization failures (including raw-query SQLSTATE `40001`) up to eight times with bounded exponential jitter, persists completion, and increments `aggregateVersion` atomically. Aggregate reads use a Repeatable Read snapshot.

## Avatar and uploaded CV integration implemented

- The browser uploads and confirms an `AVATAR` or private `CV` with Media Service first. Profile accepts only the resulting `fileId`; client-supplied URLs, ownership, default flags, reference IDs, and download URLs are rejected by DTO whitelisting.
- `PUT /:userId/avatar` attaches or replaces the authenticated Candidate's verified public avatar. `DELETE /:userId/avatar` removes it. Exact retries and repeated removals are no-ops that do not bump the aggregate version or timestamp.
- `POST /cvs` registers a verified private uploaded CV, while `GET /cvs`, `GET /cvs/:id`, and `POST /cvs/:id/download-url` list, inspect, and create a short-lived download URL. Singular `/cv` aliases remain for Candidate backward compatibility; Application uses the versioned internal contract below.
- Profile calls Media's internal verify/bind/release/download endpoints with a service-specific key and rechecks exact owner, type, status, delivery mode, echoed identifiers, HTTPS URLs, and response shape. Media `403/404/409/410/422` responses deliberately collapse to `422 MEDIA_FILE_INVALID` so the API does not become a file-existence oracle.
- Each attach/register operation uses a unique logical Media reference. Database writes run without holding a transaction open across HTTP calls; failed or losing operations release their unused reference, and replaced/removed avatar references are released after commit. Cleanup retries three times, but a process crash or a prolonged Media outage can still leave a safe orphan reference until a durable release outbox/reconciler is added.
- At most five active CV rows are allowed per Candidate under the Profile row lock. The first CV becomes default, concurrent duplicate submissions converge to one row/reference, and every stored uploaded CV keeps `fileUrl=null`; access is generated on demand from Media.

## Canonical Application CV contract implemented

- Every `/internal/v1/...` endpoint requires exactly one `X-Internal-Service: application-service` header and the service-specific `X-Internal-Api-Key` configured by `INTERNAL_API_KEY_APPLICATION`. Invalid, duplicate, placeholder, control-character-bearing, or shorter-than-32-byte keys fail closed; configuration is checked before listening and by readiness.
- `POST /internal/v1/cvs/verify` additionally requires the Candidate bearer JWT forwarded by Application. Profile independently enforces its strict JWT contract, role `CANDIDATE`, and exact subject equality with `candidateId`; this dual authentication prevents Application service credentials alone from selecting a Candidate's CV. Missing, wrong-owner, deleted, and legacy URL-only CVs return `available=false` without exposing which condition failed.
- `GET /internal/v1/candidates/:candidateId/cvs` returns active Media-backed `UPLOAD` and `ONLINE` revisions, default first and then newest. `GET /internal/v1/candidates/:candidateId/cvs/:cvId` resolves one exact Media-backed revision and deliberately permits a soft-deleted revision so an authorized recruiter can inspect what an existing Application referenced.
- `POST /internal/v1/candidates/:candidateId/cvs/:cvId/download-url` resolves the same exact revision and asks Media for a short-lived private URL. It never returns a stable file URL and sets `Cache-Control: private, no-store` plus `Pragma: no-cache`.
- The internal metadata projection is limited to `cvId`, `candidateId`, `title`, `type`, `fileId`, `isDefault`, `isDeleted`, `firstUsedAt`, `aggregateVersion`, `createdAt`, and `updatedAt`. It excludes `fileUrl`, `mediaReferenceId`, builder `contentJson`, and Profile PII. All internal endpoints are excluded from Swagger and legacy URL-only rows are excluded from this contract.
- Application's V6 usage ledger is now the durable source of truth for whether a `cvId` has ever been submitted. Profile does not yet mirror its `firstUsedAt` from that ledger, and hard delete remains disabled until the next lifecycle task adds an atomic deletion fence/reservation; rename, default handover, and soft delete do not need to wait for hard delete.

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

Each criterion contributes at most once, for a maximum of 100. Responses include `completionPercent`, `completionRuleVersion=1`, and `missingSections`; a non-blocking warning is returned only below 50%. Avatar remains excluded because rule v1 is frozen for backward compatibility even though Media verification is now implemented; changing its weight requires an explicit rule v2 migration. The completion migration transactionally backfills persisted scores for existing profiles before rule v1 is claimed.

## Run locally

```bash
npm ci
export DATABASE_URL='postgresql://profile:profile@localhost:5432/recruitment?schema=profile'
export MEDIA_SERVICE_URL='http://localhost:3001'
export MEDIA_INTERNAL_API_KEY='replace-with-at-least-32-random-bytes'
export INTERNAL_API_KEY_APPLICATION='replace-with-a-distinct-application-to-profile-key-of-at-least-32-bytes'
export MEDIA_REQUEST_TIMEOUT_MS='3000'
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

The Docker suite exercises both upgrade paths: completion backfill from a whitespace-bearing legacy Profile and Media integration over existing avatar/CV rows without rewriting their legacy URLs. It then deploys all migrations to a clean PostgreSQL 16 instance, runs 19 unit tests and 45 integration tests, and deploys migrations a second time to prove there are no pending changes. Destructive test scripts fail before `DROP/TRUNCATE` unless `ALLOW_PROFILE_SCHEMA_RESET=true` and the database name ends in `_test`. Coverage includes real constraints/relations/JSONB/CV revision behavior, strict JWT failures, validation/IDOR for all child types, OpenAPI contracts, collection caps, Unicode normalization, completion persistence, Media response hardening, private CV delivery, compensation, concurrent Profile/avatar/CV writes, internal key hardening, dual-auth submission verification, historical soft-deleted revision reads, privacy projection, and exact download authorization:

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from profile-tests
docker compose -f compose.test.yml down -v
```

## Deliberately pending P08 work

- Candidate CV lifecycle beyond registration/list/detail: rename, atomic default handover, soft delete with deterministic replacement default, and compare-and-set behavior. The five-CV cap and first default are already enforced.
- CV Builder create/edit/clone behavior and versioned JSON API. Editing a used Online CV must create a new immutable revision rather than mutate the `cvId` referenced by an Application.
- Mirroring Application's durable `firstUsedAt` into Profile. The Application ledger and lookup are authoritative today, so Profile must not infer unused state from its still-null local mirror.
- Hard delete remains disabled even for a lookup result of `used=false`: the lookup-to-delete window is racy with a concurrent submission. A future deletion fence/reservation or equivalent serialization with Application must close that race before unused-only hard delete can be exposed.
- The edit API/UI must make the revision behavior explicit: reopening a used Online CV creates a new `cv_id`, preserving exactly what Application referenced; default selection may then move to the new revision transactionally.
- A deployed multi-service REST contract/E2E suite remains part of P17. The service suites cover the canonical request/response and security behavior, but this task does not claim the full Candidate or Recruiter journey.
- Canonical versioned `cv-events` contract, transactional writer, publisher/retry/retention, and AI consumer integration.
- A durable Media-reference release outbox/reconciler. Current cleanup is post-commit best effort with bounded retry and preserves database correctness, but can leak a reference after process failure or prolonged Media outage.
- Separate PostgreSQL role grants so Profile PII is inaccessible to other service roles. The image supports a separate migration job, but repository-wide grants are still pending.
- Root Compose currently follows the repository's shared-PostgreSQL/schema-per-service layout. This is an explicit deviation from the architecture document's separate `profile-db` database/container and must be resolved or formally accepted before production.
- Candidate Profile `aggregate_version` is monotonic and transactional, and CV registration now enforces the max-five rule under the Profile lock. CV compare-and-set, exact-one-default handover after update/delete, and atomic CV+event-intent writes belong to later service/event tasks.
- Distributed per-user/ingress rate limiting remains production hardening; collection rows are now transactionally bounded, but request frequency still needs a shared gateway/WAF policy for multi-replica production.
