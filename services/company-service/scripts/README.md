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
   status, each migration-file checksum, no schema drift, Media and audit
   constraints, unchanged legacy data, and unchanged catalog/ledger on the
   second deploy. The audit probe covers valid decisions/OWNER transfer,
   invalid action shapes, duplicate aggregate evidence, FK restriction,
   append-only `UPDATE`/`DELETE`/`TRUNCATE`, failed-audit transaction rollback
   and the partial unique OWNER index, then rolls the whole probe back.
4. Creates and validates an upgraded backup, then restores the pre-upgrade and
   upgraded archives in a single transaction into two new, empty and different
   databases. The pre-upgrade restore must have only two migrations and pass an
   old-schema database read/write/cascade probe. The upgraded restore must
   match the source catalog and data, including audit trigger/function
   definitions, and pass the audit probe again.
5. Truncates a private archive copy and requires `pg_restore --list` to reject
   it before a restore target is created.

This is a migration gate, not a production backup system and not proof that an
old application can safely write to the upgraded schema. An old writer can
create media rows without the new reference binding, which the new application
intentionally hides. Never run old and new Company writers against the upgraded
database, and never attempt an in-place down migration.

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
