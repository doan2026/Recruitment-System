# Job & Search Service

B2-C01 establishes PostgreSQL as the source of truth for job drafts.
Nginx strips the `/jobs` gateway prefix before forwarding requests.

| Internal | Gateway | Access |
| --- | --- | --- |
| `GET /health` | `GET /jobs/health` | Public |
| `POST /` | `POST /jobs/` | RECRUITER, VERIFIED company |
| `GET /mine` | `GET /jobs/mine` | RECRUITER |
| `GET /:id` | `GET /jobs/:id` | Public, PUBLISHED only |
| `PUT /:id` | `PUT /jobs/:id` | OWNER or creating MEMBER |

Creating a job always stores `DRAFT`. Company membership and VERIFIED status
are resolved through `GET /companies/by-user/:userId` with the caller JWT.
OWNER manages every company job; MEMBER only manages jobs they created.

Salary is either negotiable (both bounds null) or a complete range where
`salaryMin <= salaryMax`. Deadline must be later than today. Editing critical
content on a PUBLISHED job moves it back to `PENDING_APPROVAL`; publishing,
moderation, Elasticsearch indexing and Kafka belong to later B2 branches.

```bash
npm install
npm run prisma:generate
npm test
npm run build
```

Swagger: `/docs` directly or `/jobs/docs` through the gateway.
