# Job & Search Service

B2-C01 establishes PostgreSQL as the source of truth for jobs. B2-C02 adds
the moderated publishing lifecycle.
Nginx strips the `/jobs` gateway prefix before forwarding requests.

| Internal | Gateway | Access |
| --- | --- | --- |
| `GET /health` | `GET /jobs/health` | Public |
| `POST /` | `POST /jobs/` | RECRUITER, VERIFIED company |
| `GET /mine` | `GET /jobs/mine` | RECRUITER |
| `GET /pending` | `GET /jobs/pending` | ADMIN |
| `GET /search` | `GET /jobs/search` | Public |
| `GET /:id` | `GET /jobs/:id` | Public, PUBLISHED only |
| `PUT /:id` | `PUT /jobs/:id` | OWNER or creating MEMBER |
| `PATCH /:id/publish` | `PATCH /jobs/:id/publish` | OWNER or creating MEMBER |
| `PATCH /:id/close` | `PATCH /jobs/:id/close` | OWNER or creating MEMBER |
| `PATCH /:id/approve` | `PATCH /jobs/:id/approve` | ADMIN |
| `PATCH /:id/reject` | `PATCH /jobs/:id/reject` | ADMIN |

Creating a job always stores `DRAFT`. Company membership and VERIFIED status
are resolved through `GET /companies/by-user/:userId` with the caller JWT.
OWNER manages every company job; MEMBER only manages jobs they created.

Salary is either negotiable (both bounds null) or a complete range where
`salaryMin <= salaryMax`. Deadline must be later than today. Editing critical
content on a PUBLISHED job moves it back to `PENDING_APPROVAL`.

Lifecycle: `DRAFT -> PENDING_APPROVAL -> PUBLISHED -> CLOSED|EXPIRED`.
Admin rejection returns a pending job to `DRAFT` and stores the reason and
review metadata. The expiry worker runs at startup and then hourly (configurable
with `JOB_EXPIRY_INTERVAL_MS`) and expires published jobs whose deadline is
before the current UTC date. Elasticsearch indexing and Kafka publishing belong
to later B2 branches.

Search accepts `q`, `location`, `salaryMin`, `salaryMax`, comma-separated
or repeated `skills`, `experienceYears`, `jobType`, `companyId`, `sort`,
`page`, and `limit` (maximum 50). Sort is `RELEVANCE`, `NEWEST`, or
`SALARY_DESC`. Results include total count, facets, and the data source used.
If Elasticsearch is unavailable or the index has not been created yet, the
request falls back to PostgreSQL. PostgreSQL facets describe the returned page;
Elasticsearch facets describe the complete filtered result set.
The Elasticsearch request timeout defaults to two seconds and is configurable
with `ELASTICSEARCH_REQUEST_TIMEOUT_MS`.

```bash
npm install
npm run prisma:generate
npm test
npm run build
```

Swagger: `/docs` directly or `/jobs/docs` through the gateway.
