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
| `GET /health` | `GET /companies/health` | Public |

Nginx strips the `/companies` prefix, so controllers intentionally have no
`companies` prefix.

Creating a profile creates the `Company` and its OWNER membership atomically
in PENDING status. A recruiter can belong to only one company. An ADMIN can
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

Company Service stores only canonical `fileId + url` references returned by
Media Service. C01 does not upload to or delete from Cloudinary. Replacing a
media list or removing a logo changes local references; orchestration of real
file deletion must be added with the Media Service integration task.

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
