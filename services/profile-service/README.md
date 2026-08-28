# Profile Service

NestJS/Prisma service that owns Candidate profile data and CV metadata in the PostgreSQL `profile` schema.

## Persistence implemented

- `Profile` is keyed internally by UUID and has a unique external Auth `user_id`; no cross-service database foreign key is used.
- Owned `Education`, `Experience`, `Skill`, `Certificate`, and `Project` rows cascade with the profile.
- `Cv` references `Profile.user_id` with `ON DELETE RESTRICT`, stores upload/online-builder metadata, a schema version, aggregate version, default/deleted state, and first-use marker. New uploaded CVs store an immutable Media reference and no public URL; the nullable `file_url` column remains only for legacy compatibility.
- A partial unique index prevents more than one active default CV per Candidate, while a deferred database constraint requires exactly one default whenever active CVs exist. The lifecycle migration takes Profile/CV writer locks, deterministically backfills the newest active CV (then UUID ascending) for legacy Candidates without a default, and increments both affected CV and Profile aggregate versions.
- Every CV row is now an immutable published snapshot with `revisionSeriesId`, `revisionNumber`, and an optional unique predecessor. PostgreSQL permits at most one active revision per series and prevents forks. Content/file changes always create a new Online CV revision, even when the current usage lookup would say unused, because a separate lookup cannot serialize with a concurrent Application submission in another database. Application still owns the durable usage ledger, and all hard deletes remain fail-closed until a deletion fence/reservation contract exists.

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
- At most five active CV rows and 50 retained CV snapshots are allowed per Candidate under the Profile row lock. The retained quota counts deleted Upload roots and Online revision history because those rows/references remain immutable until a cross-service retention fence exists; overflow returns `409 CV_SNAPSHOT_LIMIT_REACHED` and releases the rejected Media binding. The first CV becomes default, concurrent duplicate submissions converge to one row/reference, and every stored uploaded CV keeps `fileUrl=null`; access is generated on demand from Media.

## Canonical Application CV contract implemented

- Every `/internal/v1/...` endpoint requires exactly one `X-Internal-Service: application-service` header and the service-specific `X-Internal-Api-Key` configured by `INTERNAL_API_KEY_APPLICATION`. Invalid, duplicate, placeholder, control-character-bearing, or shorter-than-32-byte keys fail closed; configuration is checked before listening and by readiness.
- `POST /internal/v1/cvs/verify` additionally requires the Candidate bearer JWT forwarded by Application. Profile independently enforces its strict JWT contract, role `CANDIDATE`, and exact subject equality with `candidateId`; this dual authentication prevents Application service credentials alone from selecting a Candidate's CV. Missing, wrong-owner, deleted, and legacy URL-only CVs return `available=false` without exposing which condition failed.
- `GET /internal/v1/candidates/:candidateId/cvs` returns active Media-backed `UPLOAD` and `ONLINE` revisions, default first and then newest. `GET /internal/v1/candidates/:candidateId/cvs/:cvId` resolves one exact Media-backed revision and deliberately permits a soft-deleted revision so an authorized recruiter can inspect what an existing Application referenced.
- `POST /internal/v1/candidates/:candidateId/cvs/:cvId/download-url` resolves the same exact revision and asks Media for a short-lived private URL. It never returns a stable file URL and sets `Cache-Control: private, no-store` plus `Pragma: no-cache`.
- The internal metadata projection is limited to `cvId`, `candidateId`, `title`, `type`, `fileId`, `isDefault`, `isDeleted`, `firstUsedAt`, `aggregateVersion`, `createdAt`, and `updatedAt`. It excludes `fileUrl`, `mediaReferenceId`, builder `contentJson`, and Profile PII. All internal endpoints are excluded from Swagger and legacy URL-only rows are excluded from this contract.
- Application's V6 usage ledger is the durable source of truth for whether a `cvId` has ever been submitted. Profile consumes its exact lookup contract during soft delete and mirrors the authoritative `firstUsedAt` when present. Hard delete remains disabled because a separate `used=false` lookup followed by delete has a TOCTOU race with concurrent submission; an atomic cross-service deletion fence/reservation is still required.

## Candidate CV lifecycle implemented

- `PATCH /cvs/:id` renames an active owned CV with `{title, expectedAggregateVersion}`. `PATCH /cvs/:id/default` atomically hands the default flag to an active owned CV with `{expectedAggregateVersion}`. These lifecycle routes support both `UPLOAD` and `ONLINE`; singular `/cv/:id` aliases remain supported.
- `DELETE /cvs/:id` is deliberately soft-delete-only and requires `{expectedAggregateVersion}`. It returns `deletionMode=SOFT`, `deletedAt`, the replacement default CV ID when one was selected, and the new CV aggregate version. The row, `fileId`, and immutable Media reference are retained so Application can continue to resolve the exact historical revision; Profile does not release the Media reference.
- Rename, default handover, and delete use compare-and-set semantics under the existing Serializable Profile lock/retry boundary. Exact rename/default retries are no-ops. Deleting the current default chooses the newest remaining active CV, with UUID ascending as a deterministic tie-breaker; deleting the last active CV leaves no default.
- Before a first soft delete, Profile calls Application's hidden `POST /internal/v1/cv-usages/lookup` outside the database transaction, validates the exact echoed usage state, then re-locks and rechecks the CV version before mutation. A used CV mirrors the authoritative `firstUsedAt`; an unused CV is still soft-deleted. Invalid, unauthorized, unavailable, redirected, oversized, or inconsistent Application responses fail closed without a Profile mutation.
- The Profile-to-Application direction uses `APPLICATION_SERVICE_URL`, `APPLICATION_INTERNAL_API_KEY`, and `APPLICATION_REQUEST_TIMEOUT_MS`. Its key is distinct from `INTERNAL_API_KEY_APPLICATION`, which protects the Application-to-Profile direction; startup/readiness validation rejects missing, placeholder, short, malformed, or equal directional keys.
- Hard delete is not exposed. Local serializable transactions and a pre-delete lookup cannot serialize with a concurrent Application submission across two databases, so opening hard delete safely requires a deletion fence/reservation owned by the Application submission path. If submission commits after an unused lookup result, the local `firstUsedAt` mirror can temporarily remain null; Application's durable ledger remains authoritative and the retained soft-deleted row/Media reference prevents data loss.

## Online CV Builder implemented

- `POST /cvs/online` publishes an owner-only Online CV snapshot from `title`, safe `templateId`, `contentSchemaVersion=1`, object `contentJson`, and a confirmed private PDF `fileId`. `GET /cvs/:id/builder` reopens only the Candidate's active Online snapshot. `POST /cvs/:id/revisions` accepts a full replacement snapshot plus `expectedAggregateVersion` and always returns a new `cvId`; singular `/cv` aliases are supported.
- The frontend renders the PDF, uploads and confirms it through Media Service, then submits the resulting `fileId`. Profile verifies exact owner/type/ACTIVE/private-delivery metadata and binds a new `PROFILE_CV` reference before the database write. Media does not render the PDF and cannot prove semantic equality between the PDF and `contentJson`; a trusted deterministic renderer remains a separate frontend/worker concern.
- Builder JSON is explicitly versioned. The current API accepts only version 1, requires a plain JSON object, rejects unsafe prototype keys/non-JSON values/invalid PostgreSQL Unicode, bounds nesting and node count, and caps the normalized PostgreSQL JSONB text at 1 MiB in both validation and the database. Validation accounts for JSONB separator spacing and exponent-number expansion instead of measuring compact JSON only; the HTTP parser includes bounded envelope headroom above that limit.
- Revision handover runs under the existing Serializable Profile lock and CAS boundary: the predecessor is soft-deleted, its file/content/reference remain untouched, the successor receives a new `cvId`, `fileId`, Media reference and monotonic revision number, and the Profile version increments once. A default predecessor transfers default atomically; `makeDefault=true` may move default from another active CV. Replacing a revision does not consume another active-CV slot, so it works at the five-CV limit.
- Exact create/revision retries converge without another Media call. Concurrent successors cannot fork because `previousRevisionId` is unique and PostgreSQL enforces one active row per series; the losing request releases only its newly bound reference. Existing summaries/lifecycle/download routes now include both Media-backed `UPLOAD` and `ONLINE` CVs, while ordinary list/detail responses never expose builder JSON and the internal Application projection remains unchanged.

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
export APPLICATION_SERVICE_URL='http://localhost:8081'
export APPLICATION_INTERNAL_API_KEY='replace-with-a-distinct-profile-to-application-key-of-at-least-32-bytes'
export INTERNAL_API_KEY_APPLICATION='replace-with-a-distinct-application-to-profile-key-of-at-least-32-bytes'
export MEDIA_REQUEST_TIMEOUT_MS='3000'
export APPLICATION_REQUEST_TIMEOUT_MS='3000'
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

The Docker suite exercises completion, Media, CV lifecycle, and Online Builder upgrade paths without rewriting legacy URLs. It deploys all migrations to a clean PostgreSQL 16 instance, runs 33 unit tests and 62 integration tests, and deploys migrations a second time to prove there are no pending changes. Upgrade coverage holds legacy writers open independently while both the default and revision migrations wait, then proves deterministic default/lineage backfill includes the committed rows. Destructive test scripts fail before `DROP/TRUNCATE` unless `ALLOW_PROFILE_SCHEMA_RESET=true` and the database name ends in `_test`. Coverage includes real constraints/relations/JSONB, strict JWT failures, validation/IDOR, OpenAPI contracts, collection/CV-retention caps, completion persistence, Media hardening/private delivery/compensation, canonical Application access, lifecycle CAS/default/delete behavior on Upload and Online CVs, versioned Builder JSON at the exact JSONB byte boundary, large-body parsing, immutable snapshots, idempotent create/revision including default intent, default transfer, revision at the five-CV limit, barrier-synchronized concurrent successor serialization, loser-reference cleanup, historical revision resolution, direct-SQL lineage/content guards, and migration safety:

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from profile-tests
docker compose -f compose.test.yml down -v
```

## Deliberately pending P08 work

- Hard delete remains disabled even for a lookup result of `used=false`: the lookup-to-delete window is racy with a concurrent submission. A future deletion fence/reservation or equivalent serialization with Application must close that race before unused-only hard delete can be exposed.
- The Candidate CV Manager/Builder UI, template components, browser PDF renderer, and live Cloudinary preset smoke remain frontend/deployment work. The backend contract intentionally starts from an already confirmed Media `fileId` and does not claim a server-side renderer.
- A deployed multi-service REST contract/E2E suite remains part of P17. The service suites cover the canonical request/response and security behavior, but this task does not claim the full Candidate or Recruiter journey.
- Canonical versioned `cv-events` contract, transactional writer, publisher/retry/retention, and AI consumer integration.
- A durable Media-reference release outbox/reconciler. Current cleanup is post-commit best effort with bounded retry and preserves database correctness, but can leak a reference after process failure or prolonged Media outage.
- Separate PostgreSQL role grants so Profile PII is inaccessible to other service roles. The image supports a separate migration job, but repository-wide grants are still pending.
- Root Compose currently follows the repository's shared-PostgreSQL/schema-per-service layout. This is an explicit deviation from the architecture document's separate `profile-db` database/container and must be resolved or formally accepted before production.
- Candidate Profile and CV aggregate versions are monotonic and transactional; registration enforces the max-five rule, lifecycle mutations use compare-and-set, and the database now enforces exactly one default whenever active CVs exist. Atomic CV+event-intent writes belong to the later event task.
- Distributed per-user/ingress rate limiting remains production hardening; collection rows and retained CV snapshots are now transactionally bounded, but request frequency still needs a shared gateway/WAF policy for multi-replica production.
