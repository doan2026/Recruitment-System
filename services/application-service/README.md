# Application Service

This Spring Boot 3 / Java 21 service owns the recruitment application pipeline.
This branch implements candidate submission only. Nginx strips the
`/applications` gateway prefix before forwarding requests.

| Internal | Gateway | Access |
| --- | --- | --- |
| `POST /` | `POST /applications` | CANDIDATE |
| `GET /actuator/health` | Direct health check | Public |
| `GET /docs` | `GET /applications/docs` | Public |

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
```
