# Admin & Statistics Service

Spring Boot 3 / Java 21. Admin stores only moderation/audit/statistics data in its own `admin` schema. It never reads another service's database.

## REST MVC structure

Admin follows the same layer layout as Auth, using `@RestController` for JSON APIs and constructor injection. JDBC/Flyway remain the persistence stack; this refactor does not introduce JPA or change the database schema.

```text
com.recruitment.admin
├── AdminServiceApplication.java    Application entry point and component-scan root
├── controller/                    Moderation, reports, audit, statistics and health endpoints
├── dto/                           Validated request records and explicit JSON responses
├── service/                       Authorization checks and business orchestration
├── repository/                    Moderation/audit and statistics SQL
├── model/                         Report, audit, event, daily statistic and page values
├── config/                        Spring Security, OpenAPI and Kafka retry configuration
├── security/filter/               Request IDs and private response headers
├── infrastructure/
│   ├── client/                    Auth, Company and Job HTTP gateway
│   ├── kafka/                     Event parser and Kafka listener adapter
│   └── scheduler/                 Daily statistics aggregation trigger
├── exception/                     Business failures and @RestControllerAdvice
└── support/                       Shared moderation-reason validation
```

Controllers bind/validate HTTP input and map responses; they do not execute SQL, call persistence repositories or HTTP gateways directly, implement moderation decisions, or build CSV/XLSX files. Services recheck durable Admin state through Auth before privileged work. `POST /reports` remains available to any authenticated Candidate, Recruiter or Admin.

`ModerationRepository` owns report row locks, version checks, hourly quotas and append-only audit writes. Its audit method retains `REQUIRES_NEW`, and remote mutations remain outside a shared database transaction. Typed `Report` and `AuditEntry` values are mapped to response DTOs with the original snake_case JSON fields.

`StatisticsRepository` owns event idempotency, poison-record quarantine, dirty dates and cohort queries. The Kafka listener and scheduler call transactional methods on the injected `StatisticsService` bean so commit/acknowledgment order and `SKIP LOCKED` semantics remain intact. `StatisticsExportService` owns bounded CSV/XLSX generation.

Existing paths, status codes, `{data, meta}` / `{code, message, details}` envelopes, upstream origins, Kafka contracts, UTC aggregation schedule and Flyway migrations are preserved. Upstream moderation/directory JSON is forwarded as `JsonNode`; owned data uses explicit DTOs. Tests mirror the new packages, with cross-layer PostgreSQL checks under `integration`.

## Implemented routes

Gateway strips `/admin`; direct service routes below have no prefix.

| Method | Route | Access |
|---|---|---|
| GET | /companies/pending?page=1&limit=20 | ADMIN |
| PATCH | /companies/{id}/verify | ADMIN; APPROVE or REJECT, rejection needs reason |
| GET | /jobs/pending | ADMIN; upstream currently returns at most 50 |
| PATCH | /jobs/{id}/approve | ADMIN |
| PATCH | /jobs/{id}/reject | ADMIN; reason required |
| GET | /users?email=&role=&locked=&page=1&limit=20 | ADMIN |
| PATCH | /users/{id}/lock | ADMIN; lock requires reason |
| POST | /reports | Authenticated Candidate, Recruiter or Admin |
| GET | /reports?status=&type=&page=1&limit=20 | ADMIN |
| PATCH | /reports/{id} | ADMIN; expectedVersion, status, resolution |
| GET | /audit-logs?page=1&limit=20 | ADMIN |
| GET | /stats/overview?from=YYYY-MM-DD&to=YYYY-MM-DD | ADMIN |
| GET | /stats/funnel?from=&to= | ADMIN |
| GET | /stats/export?type=xlsx\|csv&from=&to= | ADMIN |

Swagger: direct `/swagger-ui/index.html`, OpenAPI `/v3/api-docs`, only with `SWAGGER_ENABLED=true`. Public deployment should keep docs disabled. Auth uses RS256 JWKS with issuer/audience/time/subject/role validation. Every administrative operation also checks durable Admin status via Auth's `/auth/me`; Auth outage fails closed. Bearer tokens are forwarded only to configured service origins, never to user-selected URLs.

## Moderation consistency

Remote moderation cannot share a database transaction with Admin. Admin first commits an append-only STARTED audit record, calls the owning service, then appends SUCCEEDED, FAILED (definite 4xx rejection) or UNKNOWN (timeout/outage). A missing terminal outcome or UNKNOWN must be reconciled with the owning service before a human retries. Do not blindly retry mutations. Audit contains acting Admin, target, reason, operation ID and UTC time; a database trigger prohibits UPDATE/DELETE.

Reports use a row lock and expectedVersion compare-and-set. Reports enter PROCESSING before remote action. Only a successful remote action can produce RESOLVED. USER reports lock their exact target through Auth. DISMISSED performs no remote action. A definite remote rejection reopens the report; an ambiguous failure leaves PROCESSING for operator investigation. An unexpected process crash may likewise leave PROCESSING. This version does not automate that investigation or provide a force-resolve endpoint.

Existing Job/Company services do not offer Admin takedown for already published jobs/verified companies. Those reports can be received/listed/dismissed; RESOLVED fails explicitly with TAKEDOWN_CONTRACT_UNAVAILABLE and reopens the report. Approval/rejection endpoints only review pending resources. Integration must add an idempotent takedown contract before enabling the remaining resolution actions.

## Statistics semantics

Consumes current `job-events` and `application-events` v1. Unique event_id provides idempotency. DRAFT creation is not counted as a posted job; the first PUBLISHED observation is. Applied/Interview/Offer/Hired metrics count the first occurrence per entity/stage, so both OFFER_SENT and STATUS_CHANGED cannot inflate the offer count.

00:15 UTC scheduler rebuilds dirty historical days. Late/out-of-order events mark all affected dates dirty, including a previously counted later date. Multiple replicas lock dirty dates with SKIP LOCKED. Each pass processes at most 365 dates; a large historical replay may need multiple daily runs. Aggregation uses the event log as source of truth and retains it; retention/backlog alerting remains deployment work.

Malformed events are quarantined by topic/partition/offset without storing the malformed payload. Database outages retry indefinitely and do not acknowledge a lost record. Review `admin.rejected_events` and replay corrected upstream records through an authorized operational process.

The funnel is a cohort: applications first APPLIED within the requested dates, counted through the end of the requested range. Overview reads daily materializations; funnel reads raw events. New-user/new-company metrics are explicitly unavailable because there is no approved source event. Historical counts require an upstream baseline if the service starts after historical events have expired from Kafka.

Exports accept at most 367 calendar days of the five daily metrics (at most 1,835 rows), so synchronous XLSX/CSV stays below the document's 50,000-row async threshold. Raw arbitrary-size exports are not offered.

## Run and test

Copy `.env.example` and resolve values as described in the root README. Existing Compose uses one PostgreSQL cluster with separate schemas. Production database/credential isolation is a separate migration; Admin source still accesses only its own schema.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'
mvn test
mvn -Pintegration '-Dapi.version=1.44' verify
```

Integration tests use a disposable PostgreSQL 16 Testcontainer, apply Flyway migrations, and cover duplicates, late events, poison events, CAS report handling, audit immutability, application startup and OpenAPI/security. Docker must be running. The api.version property is for newer Docker engines whose minimum API exceeds the Java client's default.

REST MVC refactor verified on 14/10/2026: **22/22 unit tests and 5/5 PostgreSQL integration tests passed (27/27 total)**. Checks cover role restrictions, authenticated report submission, audit ordering, ambiguous report outcomes, CSV/XLSX contents, statistics replay/late events, report version checks, audit immutability, DTO JSON compatibility and secured application startup/OpenAPI.

Runtime starts migrations automatically. Configure migration/runtime roles separately in a production deployment, and use a migration job if runtime DDL is prohibited. Container readiness uses Actuator database health. Internal service URLs, Kafka broker and CORS origins are explicit in `.env.example`.
