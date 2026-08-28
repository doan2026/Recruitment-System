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


## Member invitations

An OWNER invites a recruiter by email. Company Service returns the invitation
token once and stores only its SHA-256 hash. The caller must hand that token to
the email/notification flow; the raw token must not be logged or persisted.
Invitations expire after seven days. Acceptance creates a MEMBER atomically,
and the unique `CompanyMember.userId` constraint ensures one recruiter belongs
to at most one company. Removing the OWNER is blocked until ownership has been
transferred to an existing MEMBER.
## Authentication

Set `JWT_JWKS_URI` to the Auth Service JWKS endpoint for production. Keys are
selected by `kid`, cached, and restricted to RS256. For local development,
`JWT_PUBLIC_KEY` or `JWT_PUBLIC_KEY_PATH` can be used as a fallback.

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
```

Swagger is available at `/docs` internally and `/companies/docs` through
the gateway. A Postman collection is in `postman/`.
