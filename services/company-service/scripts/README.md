# Company PostgreSQL migration verification

Run the migration, backup, restore and rollback gate from
`services/company-service` before releasing a Company database migration:

```bash
./scripts/verify-postgres-migration.sh
```

The gate accepts no database target. It refuses `DATABASE_URL`, libpq target
variables and remote Docker endpoints. It creates a labelled, internal Docker
network with no published port and distinct temporary databases on one
disposable PostgreSQL 16 server. The default server image is pinned to the
verified multi-architecture PostgreSQL 16.15 digest. A verifier maintainer may
override the image, but the running server must still report major version 16:

```bash
COMPANY_MIGRATION_VERIFY_POSTGRES_IMAGE=postgres:16-alpine \
  ./scripts/verify-postgres-migration.sh
```

Every target is guarded by an exact database-name allow-list and per-run Docker
and database sentinels. The isolated network deliberately uses passwordless
trust authentication; it is unreachable through a host port and contains no
non-verifier clients. Therefore the gate has no database credential to print.
It also never prints fixture rows. Archives and diagnostic logs use a private
temporary directory and restrictive permissions. A trap removes the exact
containers, network, verifier image and directory on success, failure or
interruption. The verifier image build context is a temporary allow-list copy
of `prisma/`, so local `.env`, dependency, build and dump files are never sent
to the Docker daemon. Backup/dump/log extensions are ignored under `scripts/`
as a second guard against accidental check-in.

The gate does all of the following:

1. Builds a database with `prisma migrate deploy` from an isolated migration
   tree containing exactly the first two migrations, then loads a
   representative legacy fixture.
2. Records table counts and a data checksum, creates a custom-format mode-0600
   pre-upgrade archive, calculates SHA-256 and validates `pg_restore --list`.
3. Runs `prisma migrate deploy` twice against the original database and checks
   status, each migration-file checksum, no schema drift, Media, audit and
   public-search contracts, unchanged legacy data, and unchanged catalog/ledger
   on the second deploy. The audit probe covers valid decisions/OWNER transfer,
   invalid action shapes, duplicate aggregate evidence, FK restriction,
   append-only `UPDATE`/`DELETE`/`TRUNCATE`, failed-audit transaction rollback
   and the partial unique OWNER index, then rolls the whole probe back.
4. Creates and validates an upgraded backup, then restores the pre-upgrade and
   upgraded archives in a single transaction into two new, empty and different
   databases. The pre-upgrade restore must have only two migrations and pass an
   old-schema database read/write/cascade probe. The upgraded restore must
   match the source catalog and data, including audit trigger/function and
   public-search fold-function/index definitions, and pass the audit probe again.
5. Truncates a private archive copy and requires `pg_restore --list` to reject
   it before a restore target is created.

This is a migration gate, not a production backup system and not proof that an
old application can safely write to the upgraded schema. An old writer can
create media rows without the new reference binding, which the new application
intentionally hides. Never run old and new Company writers against the upgraded
database, and never attempt an in-place down migration.

## Public Company search correctness and load gate

Run the public-search gate from `services/company-service` after the unit,
build and migration gates pass:

```bash
./scripts/verify-public-search-load.sh
```

It accepts no URL or database target and refuses libpq target variables and a
remote Docker endpoint. It creates an exact-labelled internal Docker network
without host ports, a disposable PostgreSQL 16 database and a Company API image
from an allow-listed temporary build context. The Media worker is disabled and
the public cursor uses a fixed, non-production HMAC key inside that isolated
network. Exact container, network, image and database sentinels protect every
operation and cleanup. A 15-minute overall timeout covers the default run; an
interrupt, timeout, assertion failure or successful run removes only resources
whose ID, name and sentinel all match the current invocation.

The default gate is intentionally a benchmark profile rather than a small
smoke test:

- seed 100,000 deterministic Company rows with an exact 80/10/10 split of
  `VERIFIED`, `PENDING` and `REJECTED`, fixed UUIDs/timestamps and Vietnamese
  names; then run `ANALYZE` and record a fixture fingerprint;
- run the exact public SQL under `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with
  the PostgreSQL planner enabled normally. Unfiltered, deep row-value keyset
  continuation and selective Vietnamese FTS plans must avoid a sequential
  scan. The deep continuation must use either the partial composite B-tree or
  the global unique normalized-name B-tree (the UUID tie-breaker is redundant
  while normalized names remain unique); the selective query must use the
  public-search GIN index. The chosen indexes are included in the JSON report;
- call the real `GET /search` HTTP endpoint and traverse all 80,000 public rows
  with signed keyset cursors. Every card must have the exact public allow-list,
  preserve `(normalized_name, id)` ordering, appear once and belong to a
  VERIFIED fixture row;
- fully traverse accented, canonically decomposed and unaccented forms of
  `Công nghệ Đà Nẵng` and require identical IDs. Cursor tampering, query/limit
  scope mismatch and an unknown workflow-status parameter must return `400`;
  exact PENDING/REJECTED searches must remain empty and no request may return a
  `5xx`;
- warm 500 requests, then measure 10,000 requests at concurrency 32 with a
  fixed mix of first pages, deep continuations, Vietnamese search and no-match
  search. The hard defaults are zero errors, p95 at most 500 ms, p99 at most
  1,000 ms, at least 75 requests/second, a three-second per-request timeout and
  no response larger than 64 KiB.

The runner prints one JSON line containing the image IDs, fixture fingerprint,
correctness counts, latency distribution, throughput and thresholds, followed
by a concise `PASS` line. Do not mark the load task complete from build output
or an abbreviated test; the default 100,000-row/10,000-request invocation must
emit that machine-readable PASS report.

The workload and thresholds can be made stricter for a known runner without
adding an external target:

```bash
COMPANY_PUBLIC_SEARCH_LOAD_DATASET_SIZE=200000 \
COMPANY_PUBLIC_SEARCH_LOAD_MEASURED_REQUESTS=20000 \
COMPANY_PUBLIC_SEARCH_LOAD_CONCURRENCY=48 \
COMPANY_PUBLIC_SEARCH_LOAD_MAX_P95_MS=400 \
COMPANY_PUBLIC_SEARCH_LOAD_MAX_P99_MS=800 \
COMPANY_PUBLIC_SEARCH_LOAD_MIN_RPS=100 \
  ./scripts/verify-public-search-load.sh
```

`COMPANY_PUBLIC_SEARCH_LOAD_DATASET_SIZE` must be divisible by ten and cannot
be lower than 100,000; measured requests cannot be lower than 10,000. Other
bounded controls are documented by their names in the script, including
warmup, request timeout, response cap and the 300-3,600 second overall timeout.
The PostgreSQL image override remains guarded by a runtime major-version-16
check; the default is the same pinned PostgreSQL 16.15 digest as the migration
gate.

This is controlled single-instance evidence, not a production capacity claim.
It does not model a CDN, multiple gateway/API replicas, Internet latency,
write-heavy lifecycle churn, distributed rate limiting or a real production
data distribution. The Company Dockerfile currently uses a mutable Node tag
and installs without a package lock, so the JSON image ID must be retained with
each result and release reproducibility still requires pinning Node and the npm
dependency graph.

## Production rollback runbook

1. Drain every Company writer before the release backup and keep them drained
   during restore/cutover.
2. Stop the new artifact. Treat the pre-upgrade archive timestamp as the RPO
   cutoff: every Company write after that cutoff will be lost on rollback.
   Validate the custom archive, its SHA-256, permissions and
   `pg_restore --list` output.
3. Restore the pre-upgrade archive into a new, distinct database. Do not
   overwrite or mutate the upgraded database in place.
4. Validate the restored migration ledger, fixture/business invariants and an
   old-schema read/write probe.
5. Switch both the connection and the pinned old Company artifact together,
   then resume writers only after health checks pass. For this migration the
   last known pre-media source commit is
   `0794c24f2574976fa2e040ced6dcdb65eb9f8e6a`; a real release must pin the
   corresponding immutable image digest as well.

Keep the upgraded database and both immutable archive checksums available until
the rollback decision window closes. Production retention, encryption, access
control, point-in-time recovery and restore drills remain infrastructure-owned
controls outside this disposable gate.
