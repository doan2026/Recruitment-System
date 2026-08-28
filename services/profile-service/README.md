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

## Candidate job preferences implemented

- Candidate-authenticated `GET /job-preferences` and `PUT /job-preferences` use the JWT subject; callers cannot select a `userId`. The gateway path is `/profile/job-preferences`.
- `GET` always returns schema version 1. A Candidate with no row receives the virtual `UNSET` state with version zero, empty criteria, and null consent timestamps. `ENABLED` records explicit consent version 1 and at least one submitted role, location, job type, or minimum salary; `DISABLED` records withdrawal and clears every recommendation criterion atomically.
- Consent version 1 is scoped only to the Candidate first-page Job recommendation fallback. It does not authorize recruiter-facing `/recommend/candidates` or any other purpose.
- `PUT` is a full replacement guarded by `expectedVersion`. Stale writes return `409 JOB_PREFERENCE_VERSION_CONFLICT`; concurrent creates and updates serialize under the Profile lock. Preference versions are independent and never change Profile completion or `aggregateVersion`.
- Recommendation input is explicit only: Profile does not infer preferences from the headline, skills, CV, or other profile fields. Preference text is normalized and bounded; `%`, `_`, and `\` are rejected because downstream matching is exact and case-insensitive. Job types use a closed enum, salary is a positive VND decimal, and database constraints mirror the API invariants.
- Responses set `Cache-Control: private, no-store`, `Pragma: no-cache`, and `Vary: Authorization`. The migration creates the separate one-to-one preference aggregate without backfilling existing Candidates, so they remain `UNSET` until an explicit write.

## Candidate recruiter discovery consent implemented

- Candidate-authenticated `GET /recruiter-discovery` and `PUT /recruiter-discovery` use the JWT subject and are independent of job preferences. Existing Candidates are not backfilled: `GET` returns virtual `UNSET`, version zero, until an explicit decision.
- `PUT` is compare-and-set with `expectedVersion`. `ENABLED` requires consent version 1 for the fixed `RECRUITER_JOB_RECOMMENDATION` purpose and binds exactly one explicit active, owned, Media-backed CV. It never infers consent or a CV from job preferences, the default CV, applications, or profile data. `DISABLED` immediately withdraws consent and clears the CV binding.
- The only recruiter-discovery projection is `fullName`, nullable `headline`, and ordered skill names. It excludes avatar, phone, address, summary, social links, education, experience, projects, certificates, CV metadata/content/download access, and Media identifiers. Invalid or stale projections fail closed.
- Job Search alone calls hidden `POST /internal/v1/recruiter-discovery/snapshot` with `{schemaVersion:1,purpose}`. The deterministic Candidate-ID-ordered snapshot contains at most 500 opaque `{candidateId,cvId,discoveryVersion,profileVersion}` entries and returns `503 RECRUITER_DISCOVERY_SNAPSHOT_LIMIT_EXCEEDED` instead of truncating.
- Job Search sends at most 50 exact snapshot entries to hidden `POST /internal/v1/recruiter-discovery/resolve`. Profile revalidates consent, the bound active CV, discovery version, Profile aggregate version, owner and safe projection in one Repeatable Read snapshot. Stale or withdrawn entries are omitted, input order is preserved, and the response contains only `{candidateId,fullName,headline,skills}`.
- Both hidden endpoints require exactly `X-Internal-Service: job-search-service` and its distinct `INTERNAL_API_KEY_JOB_SEARCH`; the Application credential cannot call them, and the Job Search credential cannot call Application-scoped CV endpoints. Recruiter bearer tokens are never accepted as an alternative internal authority.

## Avatar and uploaded CV integration implemented

- The browser uploads and confirms an `AVATAR` or private `CV` with Media Service first. Profile accepts only the resulting `fileId`; client-supplied URLs, ownership, default flags, reference IDs, and download URLs are rejected by DTO whitelisting.
- `PUT /:userId/avatar` attaches or replaces the authenticated Candidate's verified public avatar. `DELETE /:userId/avatar` removes it. Exact retries and repeated removals are no-ops that do not bump the aggregate version or timestamp.
- `POST /cvs` registers a verified private uploaded CV, while `GET /cvs`, `GET /cvs/:id`, and `POST /cvs/:id/download-url` list, inspect, and create a short-lived download URL. Singular `/cv` aliases remain for Candidate backward compatibility; Application uses the versioned internal contract below.
- Profile calls Media's internal verify/bind/release/download endpoints with a service-specific key and rechecks exact owner, type, status, delivery mode, echoed identifiers, HTTPS URLs, and response shape. Media `403/404/409/410/422` responses deliberately collapse to `422 MEDIA_FILE_INVALID` so the API does not become a file-existence oracle.
- Each attach/register operation uses a unique logical Media reference. Database writes run without holding a transaction open across HTTP calls; failed or losing operations release their unused reference, and replaced/removed avatar references are released after commit. Cleanup retries three times, but a process crash or a prolonged Media outage can still leave a safe orphan reference until a durable release outbox/reconciler is added.
- At most five active CV rows and 50 retained CV snapshots are allowed per Candidate under the Profile row lock. The retained quota includes used snapshots, revision ancestors, pending deletion workflows, and legacy soft-deleted rows; eligible never-used leaves leave the quota after fenced hard deletion. Overflow returns `409 CV_SNAPSHOT_LIMIT_REACHED` and releases the rejected Media binding. The first CV becomes default, concurrent duplicate submissions converge to one row/reference, and every stored uploaded CV keeps `fileUrl=null`; access is generated on demand from Media.

## Canonical Application CV contract implemented

- Every canonical Application CV `/internal/v1/...` endpoint requires exactly one `X-Internal-Service: application-service` header and the service-specific `X-Internal-Api-Key` configured by `INTERNAL_API_KEY_APPLICATION`. Recruiter-discovery endpoints are separately scoped to Job Search as documented above. Invalid, duplicate, placeholder, control-character-bearing, or shorter-than-32-byte keys fail closed; both distinct inbound credentials are checked before listening and by readiness.
- `POST /internal/v1/cvs/verify` additionally requires the Candidate bearer JWT forwarded by Application. Profile independently enforces its strict JWT contract, role `CANDIDATE`, and exact subject equality with `candidateId`; this dual authentication prevents Application service credentials alone from selecting a Candidate's CV. Missing, wrong-owner, deleted, and legacy URL-only CVs return `available=false` without exposing which condition failed.
- `POST /internal/v2/cvs/verify` preserves the same request, dual-auth checks, CV projection, and unavailable semantics. For an available CV only, it additionally returns `profileSkillSnapshot={schemaVersion:1,profileAggregateVersion,skills}` from the same Repeatable Read snapshot as the CV check. Skills are capped at 100 and ordered by Profile `sortOrder`, then UUID; the projection returns names only and excludes skill IDs, levels, normalized names, and every unrelated Profile field. The read requests one sentinel row beyond the cap and fails closed if persistence has drifted past the service invariant, rather than returning a silently incomplete filter snapshot. Every unavailable result returns `profileSkillSnapshot=null`, so v2 does not create a Candidate/profile enumeration oracle. Application persists this immutable submission-time snapshot for recruiter skill filtering; it does not call Profile while listing historical Applications.
- `GET /internal/v1/candidates/:candidateId/cvs` returns active Media-backed `UPLOAD` and `ONLINE` revisions, default first and then newest. `GET /internal/v1/candidates/:candidateId/cvs/:cvId` resolves one exact Media-backed revision and deliberately permits a soft-deleted revision so an authorized recruiter can inspect what an existing Application referenced.
- `POST /internal/v1/candidates/:candidateId/cvs/:cvId/download-url` resolves the same exact revision and asks Media for a short-lived private URL. It never returns a stable file URL and sets `Cache-Control: private, no-store` plus `Pragma: no-cache`.
- The internal metadata projection is limited to `cvId`, `candidateId`, `title`, `type`, `fileId`, `isDefault`, `isDeleted`, `firstUsedAt`, `aggregateVersion`, `createdAt`, and `updatedAt`. It excludes `fileUrl`, `mediaReferenceId`, builder `contentJson`, contact details, and profile biography fields. All internal endpoints are excluded from Swagger and legacy URL-only rows are excluded from this contract.
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

## Transactional CV events implemented

- Every AI-relevant CV mutation appends an immutable `cv_event_outbox` row in the same Serializable PostgreSQL transaction. Kafka delivery is at-least-once with a stable `event_id`; the message key is `cv_id`, and consumers must deduplicate by event ID and reject older aggregate versions. The outbox deliberately has no foreign key to CV/Profile so a `DELETED` tombstone survives physical CV deletion.
- `cv-events` schema v1 is a flat snake_case value with exactly nine fields: `event_id`, `action`, `cv_id`, `candidate_id`, `file_id`, `cv_type`, `occurred_at`, `schema_version`, and `aggregate_version`. `schema_version` is 1; action is `UPSERTED`, `DEACTIVATED`, or `DELETED`; `cv_type` is `UPLOAD` or `ONLINE`. The payload never contains a file/download URL, Profile's internal `media_reference_id`, builder JSON, CV title, contact details, or profile biography fields. AI uses its distinct Media service credential and the candidate/file/type tuple to request a short-lived private download URL only for `UPSERTED`.
- Upload and Online root creation emit `UPSERTED`. A revision atomically emits `DEACTIVATED` for its retained predecessor and `UPSERTED` for its new snapshot. Rename/default changes do not emit because the PDF content is unchanged. Explicit delete emits nothing while the Application fence remains `PENDING_FENCE`; terminal `USED` emits `DEACTIVATED` and preserves the historical vector, while terminal unused `FENCED` hard deletion emits `DELETED`. Retry/reconciliation replays never append a second terminal event.
- Multiple replicas claim due events with `FOR UPDATE SKIP LOCKED`, block a later unpublished version of the same CV, and use owner plus monotonic lease fencing for renew/success/retry compare-and-set. Kafka request/retry bounds fit inside the validated lease, long sends heartbeat the lease, failures persist only a sanitized error code with bounded exponential jitter, and an ACK-before-database-mark crash may safely redeliver the same event ID.
- `CV_EVENT_PUBLISHER_ENABLED=false` pauses dispatch without disabling transactional append. This is the safe rollout switch: migrate and deploy Profile writers first, deploy the strict AI consumer and its distinct Media key, then enable dispatch. The migration intentionally does not synthesize events for historical active CVs; a reviewed active Media-backed baseline/replay is required for an already populated environment. Published-row retention, Kafka TLS/SASL, backlog/oldest-age alerts, and deployed Profile–Media–AI E2E remain production rollout requirements.

### Controlled historical CV baseline

The one-shot baseline command covers active private CVs created before the transactional producer was deployed. It never exposes an HTTP route, never downloads a PDF, and never publishes Kafka itself. It lists only active Media-backed rows with no deletion/revision blocker and no existing outbox row for that `cvId`, then verifies exact `fileId`/Candidate ownership/type/ACTIVE/private-delivery metadata through Media outside the database transaction. A verified row is re-read after taking the Profile lock and then the CV lock in a Serializable transaction; only then is one `UPSERTED` intent appended at the CV's current `aggregateVersion`. The command does not bump Profile or CV versions.

Active legacy rows that still have `fileUrl` instead of a Media reference are counted separately and never published. Output contains aggregate counters only: it never includes CV IDs, Candidate IDs, file IDs, URLs, titles, filenames, builder JSON, Media responses, or error details. Multiple command instances are safe because every transaction rechecks for any existing event and the outbox retains its `(cvId, aggregateVersion)` uniqueness guard.

Run a bounded dry-run first; `max-batches` deliberately defaults to one:

```bash
npm run baseline:cv-events -- --batch-size 25 --max-batches 1
```

Execute requires both flags and the exact confirmation phrase:

```bash
npm run baseline:cv-events -- \
  --execute \
  --confirm CV_EVENTS_BASELINE_V1 \
  --batch-size 25 \
  --max-batches 1
```

`batch-size` is bounded to 1–100 and `max-batches` to 1–100. Exit status is non-zero while eligible rows remain or any Media verification failed, so operators must rerun the same bounded command until `eligibleRemaining=0` and `mediaErrors=0`. The active legacy count is informational and does not itself fail the command. Run this only after all old Profile writers have drained. Keep the normal Profile deployment available to dispatch the appended intents; the CLI forcibly disables its own publisher context.

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
export INTERNAL_API_KEY_JOB_SEARCH='replace-with-a-distinct-job-search-to-profile-key-of-at-least-32-bytes'
export MEDIA_REQUEST_TIMEOUT_MS='3000'
export APPLICATION_REQUEST_TIMEOUT_MS='3000'
export CV_DELETION_RECONCILE_ENABLED='true'
export CV_MEDIA_CLEANUP_ENABLED='true'
export KAFKA_BROKERS='localhost:9092'
export KAFKA_CV_TOPIC='cv-events'
export CV_EVENT_PUBLISHER_ENABLED='true'
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

## PostgreSQL/Kafka integration test

The Docker suite exercises completion, explicit Candidate job preferences, explicit recruiter-discovery consent and safe Job Search projection, Media, CV lifecycle, deletion-fence, transactional CV event intents, and Online Builder upgrade paths without rewriting legacy URLs. It deploys all migrations to a clean PostgreSQL 16 instance and deploys them a second time to prove there are no pending changes. Upgrade coverage holds legacy writers open independently while the writer-locking migrations wait, then proves deterministic backfill includes the committed rows. Destructive test scripts fail before `DROP/TRUNCATE` unless `ALLOW_PROFILE_SCHEMA_RESET=true` and the database name ends in `_test`. Coverage includes real constraints/relations/JSONB, strict JWT failures, validation/IDOR, OpenAPI contracts, preference and discovery virtual-state/auth/CAS/concurrency/no-inference/database guards, discovery withdrawal and stale-resolution fencing, collection/CV-retention caps, completion persistence, Media hardening/private delivery/compensation, canonical Application access, lifecycle CAS/default behavior, `USED` retention, fenced hard deletion, pending-saga recovery, durable Media cleanup retry, exact/private outbox payloads, direct-SQL authorization/immutability guards, versioned Builder JSON at the exact JSONB byte boundary, immutable snapshots, idempotent create/revision, concurrent successor serialization, historical revision resolution, and migration safety:

The suite also starts an isolated Apache Kafka 3.8 broker with topic auto-creation disabled and proves `cv_id` keys, exact nine-field payloads, per-CV aggregate-version order, persisted `published_at`, and that re-flushing a row already marked published emits no extra record.

The suite does not claim exactly-once delivery: a crash after broker ACK and before the database mark may redeliver the same stable `event_id`, which consumers deduplicate.

The verified clean Compose run passes 62 unit tests and 89 integration tests, applies all nine migrations to PostgreSQL 16, and reports no pending migration on the second deploy.

```bash
docker compose -f compose.test.yml up --build --abort-on-container-exit --exit-code-from profile-tests
docker compose -f compose.test.yml down -v
```

## Deliberately pending P08 work

- The Candidate CV Manager/Builder UI, template components, browser PDF renderer, and live Cloudinary preset smoke remain frontend/deployment work. The backend contract intentionally starts from an already confirmed Media `fileId` and does not claim a server-side renderer.
- A deployed multi-service REST contract/E2E suite remains part of P17. The service suites cover the canonical request/response and security behavior, but this task does not claim the full Candidate or Recruiter journey.
- The companion P11 slice now implements AI's strict `cv-events` consumer and bounded private-PDF embedding pipeline. A controlled historical baseline, live Profile–Media–AI/Cloudinary E2E, automatic published-row retention, monitoring, and Kafka TLS/SASL remain rollout work.
- Avatar replacement/removal still uses bounded post-commit reference cleanup. CV hard deletion has its own durable cleanup job, but extending the same durable mechanism to every Profile Media lifecycle remains future hardening.
- Separate PostgreSQL role grants so Profile PII is inaccessible to other service roles. The image supports a separate migration job, but repository-wide grants are still pending.
- Root Compose currently follows the repository's shared-PostgreSQL/schema-per-service layout. This is an explicit deviation from the architecture document's separate `profile-db` database/container and must be resolved or formally accepted before production.
- Candidate Profile and CV aggregate versions are monotonic and transactional; registration enforces the max-five rule, lifecycle mutations use compare-and-set, the database enforces exactly one default whenever active CVs exist, and AI-relevant CV changes now commit their event intent atomically.
- Distributed per-user/ingress rate limiting remains production hardening; collection rows and retained CV snapshots are now transactionally bounded, but request frequency still needs a shared gateway/WAF policy for multi-replica production.
