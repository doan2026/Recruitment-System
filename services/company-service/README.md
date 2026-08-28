# Company Service

This NestJS service owns company profiles and company membership data.

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
Invitations expire after seven days. Acceptance creates a MEMBER atomically,
and the unique `CompanyMember.userId` constraint ensures one recruiter belongs
to at most one company. Removing the OWNER is blocked until ownership has been
transferred to an existing MEMBER.
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
./scripts/verify-postgres-migration.sh
```

The migration verifier creates only disposable PostgreSQL 16 resources and
checks a clean two-migration baseline, Media and audit upgrade idempotency,
schema drift, append-only/transaction/OWNER constraints, custom-format backup
integrity, separate-database restore and the restore-based rollback candidate.
See
[`scripts/README.md`](scripts/README.md) for its safety guards and the
production rollback runbook. It does not certify mixed old/new writers on an
upgraded database.

Swagger is available at `/docs` internally and `/companies/docs` through
the gateway. A Postman collection is in `postman/`.
