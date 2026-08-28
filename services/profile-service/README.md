# Profile Service

NestJS/Prisma service that owns Candidate profile data and CV metadata in the PostgreSQL `profile` schema.

## Persistence implemented

- `Profile` is keyed internally by UUID and has a unique external Auth `user_id`; no cross-service database foreign key is used.
- Owned `Education`, `Experience`, `Skill`, `Certificate`, and `Project` rows cascade with the profile.
- `Cv` references `Profile.user_id` with `ON DELETE RESTRICT`, stores upload/online-builder metadata, a schema version, aggregate version, default/deleted state, and first-use marker. New uploaded CVs store an immutable Media reference and no public URL; the nullable `file_url` column remains only for legacy compatibility.
- A partial unique index prevents more than one active default CV per Candidate, while a deferred database constraint requires exactly one default whenever active CVs exist. The lifecycle migration takes Profile/CV writer locks, deterministically backfills the newest active CV (then UUID ascending) for legacy Candidates without a default, and increments both affected CV and Profile aggregate versions.
- Every CV row is an immutable published snapshot with `revisionSeriesId`, `revisionNumber`, and an optional unique predecessor. PostgreSQL permits at most one active revision per series and prevents forks. Content/file changes always create a new Online CV revision. Application owns both the durable usage ledger and the permanent V7 submission gate; PostgreSQL permits physical deletion only for a soft-deleted, never-used leaf whose exact Application fence has been durably audited by Profile.

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
- At most five active CV rows and 50 retained CV snapshots are allowed per Candidate under the Profile row lock. The retained quota includes used snapshots, revision ancestors, pending deletion workflows, and legacy soft-deleted rows; eligible never-used leaves leave the quota after fenced hard deletion. Overflow returns `409 CV_SNAPSHOT_LIMIT_REACHED` and releases the rejected Media binding. The first CV becomes default, concurrent duplicate submissions converge to one row/reference, and every stored uploaded CV keeps `fileUrl=null`; access is generated on demand from Media.

## Canonical Application CV contract implemented

- Every `/internal/v1/...` endpoint requires exactly one `X-Internal-Service: application-service` header and the service-specific `X-Internal-Api-Key` configured by `INTERNAL_API_KEY_APPLICATION`. Invalid, duplicate, placeholder, control-character-bearing, or shorter-than-32-byte keys fail closed; configuration is checked before listening and by readiness.
- `POST /internal/v1/cvs/verify` additionally requires the Candidate bearer JWT forwarded by Application. Profile independently enforces its strict JWT contract, role `CANDIDATE`, and exact subject equality with `candidateId`; this dual authentication prevents Application service credentials alone from selecting a Candidate's CV. Missing, wrong-owner, deleted, and legacy URL-only CVs return `available=false` without exposing which condition failed.
- `GET /internal/v1/candidates/:candidateId/cvs` returns active Media-backed `UPLOAD` and `ONLINE` revisions, default first and then newest. `GET /internal/v1/candidates/:candidateId/cvs/:cvId` resolves one exact Media-backed revision and deliberately permits a soft-deleted revision so an authorized recruiter can inspect what an existing Application referenced.
- `POST /internal/v1/candidates/:candidateId/cvs/:cvId/download-url` resolves the same exact revision and asks Media for a short-lived private URL. It never returns a stable file URL and sets `Cache-Control: private, no-store` plus `Pragma: no-cache`.
- The internal metadata projection is limited to `cvId`, `candidateId`, `title`, `type`, `fileId`, `isDefault`, `isDeleted`, `firstUsedAt`, `aggregateVersion`, `createdAt`, and `updatedAt`. It excludes `fileUrl`, `mediaReferenceId`, builder `contentJson`, and Profile PII. All internal endpoints are excluded from Swagger and legacy URL-only rows are excluded from this contract.
- Application's V6 usage ledger remains the durable source of truth for whether a `cvId` has ever been submitted, and the hidden lookup endpoint remains available for backward compatibility. Hard-delete authorization never relies on a standalone `used=false` lookup. Profile instead calls Application's hidden `POST /internal/v1/cv-deletion-fences/acquire` with exact UUIDv4 `candidateId`, `cvId`, and durable `deletionRequestId` values. Application serializes that request with submission through its permanent V7 gate and returns an exact HTTP 200 `USED` or `FENCED` decision; other success statuses and non-exact evidence fail closed, while endpoint 404 is treated as service unavailability during rollout.

## Candidate CV lifecycle implemented

- `PATCH /cvs/:id` renames an active owned CV with `{title, expectedAggregateVersion}`. `PATCH /cvs/:id/default` atomically hands the default flag to an active owned CV with `{expectedAggregateVersion}`. These lifecycle routes support both `UPLOAD` and `ONLINE`; singular `/cv/:id` aliases remain supported.
- `DELETE /cvs/:id` requires `{expectedAggregateVersion}` and begins a durable deletion saga. Its first Serializable transaction soft-marks the CV, performs deterministic default handover, increments aggregate versions, and creates one `PENDING_FENCE` workflow with a random UUIDv4 `deletionRequestId`. The remote Application call is made only after that transaction commits, so no database transaction is held across the network.
- Rename, default handover, and delete use compare-and-set semantics under the existing Serializable Profile lock/retry boundary. Exact rename/default retries are no-ops. Deleting the current default chooses the newest remaining active CV, with UUID ascending as a deterministic tie-breaker; deleting the last active CV leaves no default.
- A `USED` decision records Application's authoritative `firstUsedAt` and positive `applicationCount`, completes the workflow as `SOFT_RETAINED`, and preserves the CV row, `fileId`, and immutable Media reference for historical Application access. A `FENCED` decision is irreversible: no later Application for that `cvId` can commit. Profile may then hard-delete only a never-used leaf with no retained successor; the same local transaction audits the fence, creates the durable Media cleanup job, and physically deletes the CV row.
- If Application cannot provide an authoritative decision because of timeout, outage, authentication failure, or an invalid response, the safe local premark and `PENDING_FENCE` workflow remain durable and the API returns `202 Accepted` with `deletionMode=PENDING` and `cleanupPending=false`. The reconciler retries with the same `deletionRequestId`; it never creates a second logical fence. Repeating the Candidate delete with either the original precondition or the aggregate version returned by the first delete response reuses the workflow, while terminal `SOFT` and `HARD` outcomes replay without another Application decision.
- Candidate requests and background reconciliation share one atomic due-time/lease/lease-fence claim. A retry before `fenceNextAttemptAt` or while another replica owns the lease returns the stored 202 outcome without calling Application, preventing retry storms. Failed attempts durably record a safe error code and exponential backoff; terminal `USED` convergence relies on its stable `firstUsedAt`, not a later live application count.
- Hard deletion and Media cleanup are separate durable milestones. After the Profile row is removed, the cleanup worker first releases the exact Profile Media reference and then idempotently deletes the private file. Lease fencing, exponential retry, and persisted step timestamps prevent a process crash or Media outage from losing work; a completed hard-delete response reports `cleanupPending=true` until the cleanup job succeeds.
- The Profile-to-Application direction uses `APPLICATION_SERVICE_URL`, `APPLICATION_INTERNAL_API_KEY`, and `APPLICATION_REQUEST_TIMEOUT_MS`. Its key is distinct from `INTERNAL_API_KEY_APPLICATION`, which protects the Application-to-Profile direction; startup/readiness validation rejects missing, placeholder, short, malformed, or equal directional keys.
- Fence reconciliation is configured with `CV_DELETION_RECONCILE_ENABLED`, `CV_DELETION_RECONCILE_INTERVAL_SECONDS`, `CV_DELETION_RECONCILE_BATCH_SIZE`, `CV_DELETION_FENCE_LEASE_SECONDS`, `CV_DELETION_RETRY_BASE_SECONDS`, and `CV_DELETION_RETRY_MAX_SECONDS`. Durable Media cleanup uses the corresponding `CV_MEDIA_CLEANUP_ENABLED`, `CV_MEDIA_CLEANUP_INTERVAL_SECONDS`, `CV_MEDIA_CLEANUP_BATCH_SIZE`, `CV_MEDIA_CLEANUP_LEASE_SECONDS`, `CV_MEDIA_CLEANUP_RETRY_BASE_SECONDS`, and `CV_MEDIA_CLEANUP_RETRY_MAX_SECONDS` settings; validated defaults are listed in `.env.example`.
- Existing soft-deleted CVs created before the deletion-workflow migration are deliberately not backfilled. Repeating delete on one of those legacy rows returns its stable soft-retained result; automatic hard deletion applies only to workflows created under the new fence contract.

### Deletion-fence rollout

Deploy Application V7 before enabling the new Profile deletion path. Wait for the Application migration to backfill gates and for every Application replica to serve the acquire endpoint; the database trigger then protects submissions from both new and old writers. Deploy the Profile migration and new Profile replicas second, then drain all old Profile replicas before declaring rollout complete: old code remains safely soft-delete-only but does not create resumable workflows or stable retired-file errors. Keep the Profile fence and Media-cleanup workers enabled until `PENDING_FENCE` workflows and due cleanup jobs have drained; do not remove or reopen Application gate rows during a rollback because a committed `FENCED` decision is permanent. Legacy soft-deleted rows are retained, stay soft-only, and are not part of this drain.

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
export CV_DELETION_RECONCILE_ENABLED='true'
export CV_MEDIA_CLEANUP_ENABLED='true'
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

The Docker suite exercises completion, Media, CV lifecycle, deletion-fence, and Online Builder upgrade paths without rewriting legacy URLs. It deploys all migrations to a clean PostgreSQL 16 instance and deploys them a second time to prove there are no pending changes. Upgrade coverage holds legacy writers open independently while the writer-locking migrations wait, then proves deterministic backfill includes the committed rows. Destructive test scripts fail before `DROP/TRUNCATE` unless `ALLOW_PROFILE_SCHEMA_RESET=true` and the database name ends in `_test`. Coverage includes real constraints/relations/JSONB, strict JWT failures, validation/IDOR, OpenAPI contracts, collection/CV-retention caps, completion persistence, Media hardening/private delivery/compensation, canonical Application access, lifecycle CAS/default behavior, `USED` retention, fenced hard deletion, pending-saga recovery, durable Media cleanup retry, direct-SQL authorization guards, versioned Builder JSON at the exact JSONB byte boundary, immutable snapshots, idempotent create/revision, concurrent successor serialization, historical revision resolution, and migration safety:

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from profile-tests
docker compose -f compose.test.yml down -v
```

## Deliberately pending P08 work

- The Candidate CV Manager/Builder UI, template components, browser PDF renderer, and live Cloudinary preset smoke remain frontend/deployment work. The backend contract intentionally starts from an already confirmed Media `fileId` and does not claim a server-side renderer.
- A deployed multi-service REST contract/E2E suite remains part of P17. The service suites cover the canonical request/response and security behavior, but this task does not claim the full Candidate or Recruiter journey.
- Canonical versioned `cv-events` contract, transactional writer, publisher/retry/retention, and AI consumer integration.
- Avatar replacement/removal still uses bounded post-commit reference cleanup. CV hard deletion has its own durable cleanup job, but extending the same durable mechanism to every Profile Media lifecycle remains future hardening.
- Separate PostgreSQL role grants so Profile PII is inaccessible to other service roles. The image supports a separate migration job, but repository-wide grants are still pending.
- Root Compose currently follows the repository's shared-PostgreSQL/schema-per-service layout. This is an explicit deviation from the architecture document's separate `profile-db` database/container and must be resolved or formally accepted before production.
- Candidate Profile and CV aggregate versions are monotonic and transactional; registration enforces the max-five rule, lifecycle mutations use compare-and-set, and the database now enforces exactly one default whenever active CVs exist. Atomic CV+event-intent writes belong to the later event task.
- Distributed per-user/ingress rate limiting remains production hardening; collection rows and retained CV snapshots are now transactionally bounded, but request frequency still needs a shared gateway/WAF policy for multi-replica production.
