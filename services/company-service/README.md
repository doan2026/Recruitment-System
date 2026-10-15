# Company Service

This NestJS service owns company profiles and company membership data.

## Optimistic profile updates

Every `PUT /companies/:id`, including media attachment, replacement and removal,
must send `expectedVersion` from the `aggregateVersion` returned by the last
profile read or successful write. Company versions start at **0**. Missing,
non-integer and negative versions return `400`; a stale snapshot returns
`409 COMPANY_UPDATE_CONFLICT` before upload/reference side effects. Reload the
profile, preserve the draft and ask the user to reconcile before sending a new
version. A version-only body is not an update.

Unit tests preload Prisma and restore the test-process environment so the
generated client cannot inject local `.env` values into fixture configuration.
The application also skips dotenv loading under `NODE_ENV=test`; explicit test
environment variables remain available. Production dotenv handling is unchanged.


## Metrics and SLO measurement

Availability and latency SLOs need numbers that outlive a single request, and
the service had none. `GET /metrics` now serves Prometheus exposition for every
request the service handles.

```bash
curl -H "X-Internal-Api-Key: $INTERNAL_API_KEY_METRICS" \
  http://company-service:3000/metrics
```

The scrape has its own scoped credential. It carries no user, so the guard
checks a key rather than a token, compares it in constant time, and rejects a
duplicated header so a proxy and a caller cannot disagree about the credential.

No identifier reaches a label. A Company path is *templated* rather than
dropped, so `/{id}/members` and `/{id}/media/confirm` stay useful series
without ever labelling by Company id — and a path carrying two identifiers,
like `/{id}/members/{id}`, loses both. Every other unknown path collapses to
`other`, so scanning cannot grow the registry. Requests are recorded by
middleware, so a 404 flood is visible as an availability event instead of
disappearing before any handler runs.

| Metric | Type | Labels |
| --- | --- | --- |
| `company_http_requests_total` | counter | `route`, `status` (`2xx`/`4xx`/`5xx`) |
| `company_http_request_duration_seconds` | histogram | `route` |

This makes SLOs measurable. It is not a monitoring deployment: scraping,
dashboards, alert rules and error budgets remain infrastructure work.

## C01 profile, C02 verification and C03 member-management scope

| Internal route | Gateway route | Access |
| --- | --- | --- |
| `POST /` | `POST /companies/` | RECRUITER |
| `GET /me` | `GET /companies/me` | RECRUITER |
| `GET /?verified_status=PENDING&page=1&limit=20` | `GET /companies?verified_status=PENDING&page=1&limit=20` | ADMIN |
| `PATCH /:id/verify` | `PATCH /companies/:id/verify` | ADMIN |
| `POST /me/submit-verification` | `POST /companies/me/submit-verification` | Company OWNER |
| `POST /:id/members` | `POST /companies/:id/members` | Company OWNER |
| `GET /:id/members` | `GET /companies/:id/members` | Company OWNER |
| `POST /invitations/accept` | `POST /companies/invitations/accept` | RECRUITER |
| `DELETE /:id/members/:userId` | `DELETE /companies/:id/members/:userId` | Company OWNER |
| `PATCH /:id/members/:userId/transfer-ownership` | `PATCH /companies/:id/members/:userId/transfer-ownership` | Company OWNER |
| `GET /by-user/:userId` | `GET /companies/by-user/:userId` | Self recruiter / ADMIN |
| `GET /internal/:id` | Not routable publicly (gateway strips `X-Internal-Api-Key`) | Job & Search only, `X-Internal-Api-Key` = `INTERNAL_API_KEY_JOB_SEARCH`; returns `id`, `name`, `verifiedStatus` for any status so PUBLISHED jobs stay indexable during re-review |
| `GET /search?q=&cursor=&limit=` | `GET /companies/search?q=&cursor=&limit=` | Public, VERIFIED companies only |
| `GET /:id` | `GET /companies/:id` | Public, VERIFIED companies only |
| `PUT /:id` | `PUT /companies/:id` | Company OWNER |
| `POST /:id/media/signature` | `POST /companies/:id/media/signature` | Company OWNER |
| `POST /:id/media/confirm` | `POST /companies/:id/media/confirm` | Company OWNER |
| `GET /health` | `GET /companies/health` | Public |

Nginx strips the `/companies` prefix, so controllers intentionally have no
`companies` prefix.

Creating a profile creates the `Company` and its OWNER membership atomically
in PENDING status. Media is intentionally not accepted by this first request:
the authoritative Company UUID must exist before Media can issue a
`ownerType=COMPANY` upload capability. A recruiter can belong to only one company. An ADMIN can
list a status-specific review queue, then approve or reject a PENDING company.
A rejection requires a non-blank reason. Repeating the same completed decision
is idempotent; changing an already completed decision returns a conflict.

Updating a REJECTED profile does not implicitly resubmit it. Its OWNER must call
`POST /me/submit-verification`, which moves it to PENDING and clears the old
reason. A material change to `name` or `taxCode` also moves VERIFIED back to
PENDING.

Public responses omit workflow fields and raw Media Service file identifiers.
Owner responses include review status and rejection reason.

## Public company search

`GET /search` is a separate public collection contract; the existing root
`GET /` remains the ADMIN review queue. Search always fixes visibility to
`VERIFIED` and accepts only `q`, `limit` (default 20, maximum 50), and the
opaque cursor returned by the previous page. It does not accept a workflow
status, page number, offset, sort, or total-count request.

The response is `{data, meta}`. Every `data` item is a bounded card projection:
`id`, `name`, `slug`, `industry`, `size`, `address`, and `logoUrl`. It does not
load the media gallery or expose description, tax code, workflow state,
rejection reason, aggregate version, membership, invitation, audit, file, or
Media-reference identifiers. An unbound legacy logo is returned as `null`.
Call `GET /:id` for the full verified profile and call Job & Search separately
with its `companyId` filter for open jobs.

Names are searched with one to eight ANDed token prefixes. Query text is NFKC
normalized, case-folded, and Vietnamese accents plus `đ` are folded for search;
this is not fuzzy, infix-within-a-word, semantic, or relevance-ranked search.
Pages use the stable `(normalizedName ASC, id ASC)` keyset and fetch one extra
row to derive `hasMore`; there is no deep `OFFSET` or `COUNT(*)`. The HMAC-signed
cursor is versioned and bound to the canonical query and limit, so a malformed,
tampered, or cross-query cursor is rejected with HTTP 400. Pagination is a live
view, not an MVCC snapshot: refresh from page one when Company names or review
states can change during a long traversal.

Configure a distinct random secret of at least 32 UTF-8 bytes. Placeholder
values fail startup:

```dotenv
COMPANY_PUBLIC_CURSOR_HMAC_KEY=<distinct random key of at least 32 bytes>
```

Company request logs record only the path and never the query/cursor. Gateway
access-log policy remains an infrastructure concern outside this service.

## Company domain audit ledger

Company stores append-only evidence for three committed domain actions:

- an ADMIN approves a PENDING Company;
- an ADMIN rejects a PENDING Company, including the trimmed reason;
- the current OWNER transfers ownership to an existing MEMBER.

The actor is always the authenticated JWT subject. The Company/status or two
membership changes, aggregate-version increment and audit insert run in the
same Serializable transaction. A failed audit insert therefore rolls back the
business mutation, while an identical review retry/no-op creates no new audit
row. The database restricts action/field combinations, requires a positive
resulting aggregate version, rejects duplicate Company/version evidence and
prevents ordinary `UPDATE`, `DELETE` and `TRUNCATE` operations through triggers.
An audit FK also prevents hard deletion of a Company that has audit history.

This ledger starts at the audit migration; no unknown historical actor is
backfilled. It is deliberately not a complete Company status event stream:
creation, invitations, member removal, profile/media changes, owner resubmit
and a critical owner edit that resets VERIFIED to PENDING are not recorded.
There is no audit query API. Admin Service remains responsible for its separate
global operational AuditLog; Company Service does not read or write `admin-db`.

The partial unique database index guarantees at most one OWNER per Company.
Company APIs additionally prevent deleting/demoting the current OWNER and make
transfer atomic, but the index alone is not a direct-SQL guarantee that every
Company has at least one OWNER. The append-only triggers protect ordinary DML,
not a database superuser or table owner that can disable them. Production
should separate migrator and runtime roles and grant the runtime only the
required read/insert privileges on `company_audit_logs`.


## Member invitations

An OWNER invites a recruiter by email. Company Service returns the invitation
token once and stores only its SHA-256 hash. The caller must hand that token to
the email/notification flow; the raw token must not be logged or persisted.
Invitations expire after seven days. Before acceptance, Company forwards the
already-verified access token to Auth `GET /auth/me` and requires the durable
account, at recheck time, to be verified, unlocked, present, `RECRUITER`, and
to have the exact NFC-normalized invited email. The Auth call is completed
before the Serializable Company transaction; the invitation is then read
again and its current email is compared inside that transaction before every
mutation and idempotent return. A mismatch returns a redacted `403` without
disclosing either email or changing invitation/member rows. A lock, role or
email change after this point-in-time Auth response but before the Company
commit is an unavoidable distributed TOCTOU until Auth provides a versioned
introspection/fencing contract.

New invitations use Auth-compatible NFC + trim + lowercase canonicalization.
Migration `20260829200000_company_invitation_auth_binding` leaves legacy
`PENDING` rows with a null normalization marker, and Company returns
`409 INVITATION_REISSUE_REQUIRED` before any email comparison or write.
Reissuing through the OWNER API replaces/creates a token with marker version 1.
A database constraint also prevents an old rolling-deploy writer from changing
a marker-null invitation to `ACCEPTED`; already accepted legacy rows receive
terminal marker 0 without changing their workflow state. Company deliberately
does not NFKC-fold Auth identities because that could merge two addresses Auth
treats as distinct. This is only a fence for legacy marker-null rows, not full
old/new application compatibility: drain old Company writers before migration
and do not run mixed versions against the upgraded schema.

Acceptance creates a MEMBER atomically, and the unique
`CompanyMember.userId` constraint ensures one recruiter belongs to at most
one company. Removing the OWNER is blocked until ownership has been
transferred to an existing MEMBER.

The Auth client uses the fixed `/auth/me` path, exact host allowlist, no
redirect/cache, a bounded timeout/body, and strict response validation. It
fails closed for an unavailable or malformed upstream. Defaults match the
canonical internal Compose DNS and can be overridden with:

```dotenv
AUTH_SERVICE_URL=http://auth-service:8080
AUTH_SERVICE_ALLOWED_HOSTS=auth-service
AUTH_REQUEST_TIMEOUT_MS=3000
```

## Authentication

`JWT_ISSUER` and `JWT_AUDIENCE` are mandatory. Set `JWT_JWKS_URI` to the Auth
Service JWKS endpoint for production. Keys are selected by `kid`, cached, and
restricted to RSA/RS256 signing keys whose RFC 7638 thumbprint matches that
`kid`. For local development, `JWT_PUBLIC_KEY` or `JWT_PUBLIC_KEY_PATH` can be
used as a fallback; the token `kid` must match that key's thumbprint.

Accepted access tokens must also have `typ=JWT`, UUID v4 `sub` and `jti`,
integer `iat/exp`, and an exact uppercase `CANDIDATE`, `RECRUITER` or `ADMIN`
role. Company does not normalize a non-canonical role. This contract is
required because Company uses the verified `sub` as the audit actor.

## Media boundary

Company media uses a two-phase owner-only flow:

1. Create the Company without media.
2. Call `POST /:id/media/signature` with `type` and `originalFilename`. Company
   persists the returned intent identity; upload directly to the signed
   Cloudinary endpoint, then call `POST /:id/media/confirm` with `fileId + type`.
3. Attach confirmed files with `PUT /:id`. A logo accepts only `fileId`; each
   gallery item accepts `fileId`, `IMAGE|VIDEO` and optional `sortOrder`.

Company never accepts a URL from the browser. Before a domain write it asks the
direct Media origin to verify `ACTIVE`, `ownerType=COMPANY`, the exact Company
UUID and the exact `COMPANY_LOGO`, `COMPANY_IMAGE` or `COMPANY_VIDEO` type. It
persists only the canonical HTTPS URL returned by Media, binds an immutable
Media reference, and commits the reference UUID together with the Company row.
Public and owner reads suppress legacy rows that do not yet have a verified
Media reference.

Before calling Media confirm, Company requires a durable upload-intent matching
the exact `fileId`, Company UUID, requesting OWNER, asset type and expiry. A
confirmed intent caches the canonical URL for idempotent retries. This guard is
required because the current internal Media confirm route accepts only a file
UUID and must not be used as a confused deputy for another Company's upload.
The same transaction stages deterministic cleanup for `expiresAt + grace`.
Abandoned uploads are deleted to recover Media quota; attaching a file consumes
its intent and cleanup job atomically, while cleanup never deletes a file that
is already attached locally. Cached confirmation is invalid at cleanup time.

Attach compensation and detach cleanup are durable in
`company_media_operations`. The worker uses a database lease, bounded
exponential retry and exact local-reference guards. A failed/crashed attach is
reconciled by idempotently recovering the bind before release; a committed
remove releases the old reference and deletes the file only when no Company
row still points to it. Foreground requests heartbeat and fence the whole attach
batch through the domain transaction. Each logo attach uses a fresh binding
generation, so a stale detach cannot release a newly reattached logo reference.
Internal reference UUIDs are never returned publicly.

Media policy allows one active logo, ten images and one video per Company. A
full logo/video slot (or ten-image gallery) cannot upload its replacement while
the old active file still consumes quota. Use remove -> cleanup/delete ->
upload -> attach for those full-slot replacements; this intentionally has a
short display gap until Media provides an atomic replace capability.

The client calls the direct Media origin with
`X-Internal-Service: company-service` and its distinct key. It rejects
redirects, oversized/non-JSON/extra-field responses, mismatched echoed
ownership/type/ID, non-public delivery and non-HTTPS canonical URLs. Configure:

```dotenv
MEDIA_SERVICE_URL=http://media-service:3000
MEDIA_INTERNAL_API_KEY=<distinct random key of at least 32 bytes>
MEDIA_REQUEST_TIMEOUT_MS=3000
COMPANY_MEDIA_OPERATION_ENABLED=true
COMPANY_MEDIA_OPERATION_INTERVAL_SECONDS=30
COMPANY_MEDIA_OPERATION_BATCH_SIZE=10
COMPANY_MEDIA_OPERATION_LEASE_SECONDS=45
COMPANY_MEDIA_OPERATION_ATTACH_GRACE_SECONDS=30
COMPANY_MEDIA_UPLOAD_INTENT_GRACE_SECONDS=900
COMPANY_MEDIA_OPERATION_RETRY_BASE_SECONDS=5
COMPANY_MEDIA_OPERATION_RETRY_MAX_SECONDS=3600
```

The root Compose wires the same `MEDIA_INTERNAL_API_KEY_COMPANY` into Media and
Company and waits for Media readiness before starting Company.

## Media contract integration suite

`test/company-media.integration.test.js` runs the real Company application and
a real PostgreSQL 16 against a deterministic stand-in for the Media internal
API, so the whole media lifecycle is exercised over real HTTP rather than a
mocked client. This is the same standard already applied to the Profile–Media
boundary; it is deliberately **not** a live Cloudinary run, which stays a
separate File/Media gate.

The stand-in answers only the six internal routes Company actually calls and
returns exactly the envelopes the client validates, so a drift in the response
shape fails the suite instead of passing silently. The suite proves:

- an OWNER upload intent reaches Media with the exact scoped body, and the
  intent plus its deterministic cleanup job are committed together;
- a non-OWNER never reaches Media at all, so a rejected caller cannot spend
  Media quota;
- an `Idempotency-Key` is forwarded verbatim;
- confirm resolves the canonical URL, and a replay is answered from the stored
  URL without a second Media call;
- confirming another Company's intent, a mismatched asset type or an expired
  intent is refused before Media is called;
- attaching a logo verifies ownership and type before binding, and a gallery
  binds every entry under its own asset type;
- a Media outage fails closed with a sanitized `503` that leaks neither the
  internal key nor the Media origin, and leaves no Company or intent row;
- a rejected Media status maps to its own sanitized error, and a malformed
  envelope is refused instead of being stored;
- replacing a logo hands the previous file to the durable cleanup queue;
- the operation worker drives detach cleanup and abandoned-intent deletion
  through Media, retries a failing cleanup with a later attempt instead of
  dropping it, and never deletes a file that is still attached locally;
- every Media call carries the internal key and never the end-user token.

Run it through Compose, which supplies the disposable database:

```bash
docker compose -f compose.test.yml run --rm --build company-tests
```

## Run and verify

```bash
npm install
npm run prisma:migrate:deploy
npm run start:dev
```

Production startup runs pending Prisma migrations before starting the API:

```bash
npm run start:prod
```

Checks:

```bash
npm test
npm run build
docker compose -f compose.test.yml run --rm --build company-tests
./scripts/verify-postgres-migration.sh
./scripts/verify-auth-company-invitation-guards.sh
COMPANY_AUTH_INTEGRATION_CONFIRM=run-disposable-auth-company-integration \
  ./scripts/verify-auth-company-invitation.sh
./scripts/verify-public-search-load.sh
```

`npm test` runs the unit suite alone and needs no database. The Compose target
runs `prisma migrate deploy`, the unit suite and the Media contract integration
suite against a disposable PostgreSQL 16, and refuses to run unless
`ALLOW_COMPANY_SCHEMA_RESET=true` and the database name ends in `_test`. See
[Media contract integration suite](#media-contract-integration-suite) below.

The migration verifier creates only disposable PostgreSQL 16 resources and
checks a clean two-migration baseline, Media and audit upgrade idempotency,
public-search function/indexes, invitation normalization marker/old-writer
fence, schema drift, append-only/transaction/OWNER constraints, custom-format
backup integrity, separate-database restore and the restore-based rollback candidate.
See
[`scripts/README.md`](scripts/README.md) for its safety guards and the
production rollback runbook. It does not certify mixed old/new writers on an
upgraded database.

Swagger is available at `/docs` internally and `/companies/docs` through
the gateway. A Postman collection is in `postman/`.
