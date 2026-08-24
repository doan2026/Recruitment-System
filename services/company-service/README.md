# Company Service

This NestJS service owns company profiles and company membership data.

## C01 company-profile scope

| Internal route | Gateway route | Access |
| --- | --- | --- |
| `POST /` | `POST /companies/` | RECRUITER |
| `GET /me` | `GET /companies/me` | RECRUITER |
| `GET /:id` | `GET /companies/:id` | Public, VERIFIED companies only |
| `PUT /:id` | `PUT /companies/:id` | Company OWNER |
| `GET /health` | `GET /companies/health` | Public |

Nginx strips the `/companies` prefix, so controllers intentionally have no
`companies` prefix.

Creating a profile creates the `Company` and its OWNER membership atomically.
A recruiter can belong to only one company. A material change to `name` or
`taxCode` moves a VERIFIED profile back to PENDING. Updating a REJECTED
profile does not resubmit it; moderation/resubmission belongs to the later
company-verification task.

Public responses omit workflow fields and raw Media Service file identifiers.
Owner responses include review status and rejection reason.

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
