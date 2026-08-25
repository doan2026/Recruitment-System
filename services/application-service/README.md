# Application Service

This Spring Boot 3 / Java 21 service owns candidate submission, bookmarks,
application tracking, and the recruiter application pipeline. Nginx strips the
`/applications` gateway prefix before forwarding requests.

| Internal | Gateway | Access |
| --- | --- | --- |
| `POST /` | `POST /applications/` | CANDIDATE |
| `GET /my` | `GET /applications/my` | CANDIDATE |
| `GET /{applicationId}` | `GET /applications/{applicationId}` | CANDIDATE, RECRUITER |
| `GET /` | `GET /applications/` | RECRUITER |
| `PATCH /{applicationId}/status` | `PATCH /applications/{applicationId}/status` | RECRUITER |
| `PATCH /{applicationId}/withdraw` | `PATCH /applications/{applicationId}/withdraw` | CANDIDATE |
| `POST, GET /bookmarks` | `POST, GET /applications/bookmarks` | CANDIDATE |
| `DELETE /bookmarks/{jobId}` | `DELETE /applications/bookmarks/{jobId}` | CANDIDATE |
| `GET /actuator/health` | Direct health check | Public |
| `GET /docs` | `GET /applications/docs` | Public |

Recruiter access is scoped by Company Service membership. The
`GET /by-user/{userId}` contract must return both `companyId` and
`memberRole`. Both `MEMBER` and `OWNER` can list, view, and transition
applications for every job in their company, including jobs created by another
recruiter. A recruiter from another company is denied. This company-wide
Application Pipeline policy does not change Job Service ownership rules:
`MEMBER` can still edit or delete only jobs they created, while `OWNER` can
manage every job.

Submission performs these checks in order:

1. Verify the Job through `GET /jobs/:id/exists` using
   `X-Internal-Api-Key`.
2. Verify that the selected CV appears in the authenticated candidate's
   `GET /profile/cv?user_id=` response.
3. Reject an existing active application.
4. Enforce a 30-day cooldown after the latest `REJECTED` application.
5. Store `Application(APPLIED)`, initial `ApplicationHistory`, and a Kafka
   outbox row in one database transaction.

The database also has a partial unique index for active candidate/job pairs,
which protects against two concurrent submission requests. The outbox publisher
sends `application-events` with a stable `event_id` and exponential retry.

```json
{
  "event_id": "uuid",
  "action": "STATUS_CHANGED",
  "application_id": "uuid",
  "job_id": "uuid",
  "job_title": "Backend Engineer",
  "candidate_id": "uuid",
  "recruiter_id": "uuid",
  "from_status": null,
  "to_status": "APPLIED",
  "occurred_at": "2026-08-24T00:00:00Z"
}
```

```bash
mvn test
mvn package

# Requires Docker; starts disposable PostgreSQL 16 and Apache Kafka containers.
mvn verify -Pintegration-test
```

The integration profile verifies Flyway/JPA against PostgreSQL, transactional
pipeline updates, MEMBER/OWNER company-wide access and cross-company denial,
outbox delivery to a real Kafka consumer, and that an outbox row already marked
as published is not sent again.
