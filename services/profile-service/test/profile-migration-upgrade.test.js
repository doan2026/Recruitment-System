'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const root = path.resolve(__dirname, '..');

const executeMigration = (directory) => {
  const result = spawnSync(
    'npx',
    [
      'prisma',
      'db',
      'execute',
      '--file',
      path.join(root, 'prisma', 'migrations', directory, 'migration.sql'),
      '--schema',
      path.join(root, 'prisma', 'schema.prisma'),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error('Migration execution failed: ' + directory);
  }
};

const startMigration = (directory) => {
  const child = spawn(
    'npx',
    [
      'prisma',
      'db',
      'execute',
      '--file',
      path.join(root, 'prisma', 'migrations', directory, 'migration.sql'),
      '--schema',
      path.join(root, 'prisma', 'schema.prisma'),
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        process.stdout.write(output);
        resolve();
        return;
      }
      reject(
        new Error(
          `Migration execution failed: ${directory}\n${output}`,
        ),
      );
    });
  });
  return { child, completion };
};

const waitForMigrationWriterLock = async (child) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('Migration exited before waiting for the legacy writer');
    }
    const rows = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM "pg_catalog"."pg_locks" AS "lock"
        JOIN "pg_catalog"."pg_class" AS "relation"
          ON "relation"."oid" = "lock"."relation"
        JOIN "pg_catalog"."pg_namespace" AS "namespace"
          ON "namespace"."oid" = "relation"."relnamespace"
        WHERE "namespace"."nspname" = 'profile'
          AND (
            (
              "relation"."relname" = 'profiles'
              AND "lock"."mode" = 'ExclusiveLock'
            )
            OR (
              "relation"."relname" = 'cvs'
              AND "lock"."mode" = 'ShareRowExclusiveLock'
            )
          )
          AND NOT "lock"."granted"
      ) AS "waiting"
    `);
    if (rows[0]?.waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Migration did not wait for the in-flight CV writer');
};

const main = async () => {
  let canResetSchema = false;
  try {
    if (process.env.ALLOW_PROFILE_SCHEMA_RESET !== 'true') {
      throw new Error(
        'Refusing to reset the profile schema without ALLOW_PROFILE_SCHEMA_RESET=true',
      );
    }

    const databases = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS "name"',
    );
    const databaseName = databases[0]?.name;
    if (typeof databaseName !== 'string' || !databaseName.endsWith('_test')) {
      throw new Error(
        `Refusing to reset the profile schema in non-test database: ${databaseName ?? 'unknown'}`,
      );
    }
    canResetSchema = true;

    await prisma.$executeRawUnsafe(
      'DROP SCHEMA IF EXISTS "profile" CASCADE',
    );
    executeMigration('20260827000000_profile_persistence');

    await prisma.$executeRawUnsafe(`
      INSERT INTO "profile"."profiles"
        ("id", "user_id", "full_name", "headline", "summary",
         "avatar_file_id", "avatar_url", "github_url",
         "completion_percent", "updated_at")
      VALUES
        ('71000000-0000-4000-8000-000000000001',
         '71000000-0000-4000-8000-000000000002',
         'Legacy Candidate',
         E'\\t',
         E'\\n',
         '71000000-0000-4000-8000-000000000005',
         'https://media.example.com/avatars/legacy-candidate.jpg',
         'https://github.com/legacy-candidate',
         7,
         CURRENT_TIMESTAMP)
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "profile"."educations"
        ("id", "profile_id", "school", "start_date", "updated_at")
      VALUES
        ('71000000-0000-4000-8000-000000000003',
         '71000000-0000-4000-8000-000000000001',
         'Legacy University',
         DATE '2020-09-01',
         CURRENT_TIMESTAMP)
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "profile"."skills"
        ("id", "profile_id", "name", "normalized_name", "updated_at")
      VALUES
        ('71000000-0000-4000-8000-000000000004',
         '71000000-0000-4000-8000-000000000001',
         'TypeScript',
         'typescript',
         CURRENT_TIMESTAMP)
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "profile"."cvs"
        ("id", "user_id", "title", "type", "file_id", "file_url", "updated_at")
      VALUES
        ('71000000-0000-4000-8000-000000000006',
         '71000000-0000-4000-8000-000000000002',
         'Legacy CV',
         'UPLOAD',
         '71000000-0000-4000-8000-000000000007',
         'https://media.example.com/cvs/legacy-candidate.pdf',
         CURRENT_TIMESTAMP)
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "profile"."profiles" ("id", "user_id", "updated_at")
      VALUES
        ('72000000-0000-4000-8000-000000000001',
         '72000000-0000-4000-8000-000000000002',
         CURRENT_TIMESTAMP),
        ('73000000-0000-4000-8000-000000000001',
         '73000000-0000-4000-8000-000000000002',
         CURRENT_TIMESTAMP),
        ('74000000-0000-4000-8000-000000000001',
         '74000000-0000-4000-8000-000000000002',
         CURRENT_TIMESTAMP),
        ('75000000-0000-4000-8000-000000000001',
         '75000000-0000-4000-8000-000000000002',
         CURRENT_TIMESTAMP)
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "profile"."cvs"
        ("id", "user_id", "title", "type", "file_id", "file_url",
         "is_default", "is_deleted", "deleted_at", "created_at", "updated_at")
      VALUES
        ('72000000-0000-4000-8000-000000000010',
         '72000000-0000-4000-8000-000000000002',
         'Older active CV',
         'UPLOAD',
         '72000000-0000-4000-8000-000000000110',
         'https://media.example.com/cvs/older-active.pdf',
         false, false, NULL,
         TIMESTAMPTZ '2025-01-01 00:00:00+00',
         TIMESTAMPTZ '2025-01-01 00:00:00+00'),
        ('72000000-0000-4000-8000-000000000011',
         '72000000-0000-4000-8000-000000000002',
         'Newest active CV with lower UUID',
         'UPLOAD',
         '72000000-0000-4000-8000-000000000111',
         'https://media.example.com/cvs/newest-lower-uuid.pdf',
         false, false, NULL,
         TIMESTAMPTZ '2026-01-01 00:00:00+00',
         TIMESTAMPTZ '2026-01-01 00:00:00+00'),
        ('72000000-0000-4000-8000-000000000012',
         '72000000-0000-4000-8000-000000000002',
         'Newest active CV with higher UUID',
         'UPLOAD',
         '72000000-0000-4000-8000-000000000112',
         'https://media.example.com/cvs/newest-higher-uuid.pdf',
         false, false, NULL,
         TIMESTAMPTZ '2026-01-01 00:00:00+00',
         TIMESTAMPTZ '2026-01-01 00:00:00+00'),
        ('72000000-0000-4000-8000-000000000013',
         '72000000-0000-4000-8000-000000000002',
         'Deleted newest CV',
         'UPLOAD',
         '72000000-0000-4000-8000-000000000113',
         'https://media.example.com/cvs/deleted-newest.pdf',
         false, true,
         TIMESTAMPTZ '2026-03-01 00:00:00+00',
         TIMESTAMPTZ '2026-02-01 00:00:00+00',
         TIMESTAMPTZ '2026-03-01 00:00:00+00'),
        ('73000000-0000-4000-8000-000000000010',
         '73000000-0000-4000-8000-000000000002',
         'Existing default CV',
         'UPLOAD',
         '73000000-0000-4000-8000-000000000110',
         'https://media.example.com/cvs/existing-default.pdf',
         true, false, NULL,
         TIMESTAMPTZ '2025-01-01 00:00:00+00',
         TIMESTAMPTZ '2025-01-01 00:00:00+00'),
        ('73000000-0000-4000-8000-000000000011',
         '73000000-0000-4000-8000-000000000002',
         'Newer non-default CV',
         'UPLOAD',
         '73000000-0000-4000-8000-000000000111',
         'https://media.example.com/cvs/newer-non-default.pdf',
         false, false, NULL,
         TIMESTAMPTZ '2026-01-01 00:00:00+00',
         TIMESTAMPTZ '2026-01-01 00:00:00+00'),
        ('74000000-0000-4000-8000-000000000010',
         '74000000-0000-4000-8000-000000000002',
         'Only deleted CV',
         'UPLOAD',
         '74000000-0000-4000-8000-000000000110',
         'https://media.example.com/cvs/only-deleted.pdf',
         false, true,
         TIMESTAMPTZ '2026-02-01 00:00:00+00',
         TIMESTAMPTZ '2026-01-01 00:00:00+00',
         TIMESTAMPTZ '2026-02-01 00:00:00+00')
    `);

    executeMigration('20260827010000_profile_completion_rule');
    executeMigration('20260827130000_profile_media_integration');

    let markWriterInserted;
    const writerInserted = new Promise((resolve) => {
      markWriterInserted = resolve;
    });
    let releaseWriter;
    const writerRelease = new Promise((resolve) => {
      releaseWriter = resolve;
    });
    const writerCompletion = prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRawUnsafe(`
          SELECT "id"
          FROM "profile"."profiles"
          WHERE "user_id" =
            '75000000-0000-4000-8000-000000000002'::uuid
          FOR UPDATE
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "profile"."cvs"
            ("id", "user_id", "title", "type", "file_id", "file_url",
             "media_reference_id", "is_default", "updated_at")
          VALUES
            ('75000000-0000-4000-8000-000000000010',
             '75000000-0000-4000-8000-000000000002',
             'CV committed while migration waits',
             'UPLOAD',
             '75000000-0000-4000-8000-000000000110',
             NULL,
             '75000000-0000-4000-8000-000000000210',
             false,
             CURRENT_TIMESTAMP)
        `);
        markWriterInserted();
        await writerRelease;
      },
      { timeout: 15_000 },
    );
    await Promise.race([
      writerInserted,
      writerCompletion.then(() => {
        throw new Error('Legacy writer committed before the migration started');
      }),
    ]);

    const concurrentMigration = startMigration(
      '20260827140000_cv_default_invariant',
    );
    let lockWaitError;
    try {
      await waitForMigrationWriterLock(concurrentMigration.child);
    } catch (error) {
      lockWaitError = error;
    } finally {
      releaseWriter();
    }
    await writerCompletion;
    await concurrentMigration.completion;
    if (lockWaitError) {
      throw lockWaitError;
    }

    executeMigration('20260827140000_cv_default_invariant');

    let markRevisionWriterInserted;
    const revisionWriterInserted = new Promise((resolve) => {
      markRevisionWriterInserted = resolve;
    });
    let releaseRevisionWriter;
    const revisionWriterRelease = new Promise((resolve) => {
      releaseRevisionWriter = resolve;
    });
    const revisionWriterCompletion = prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRawUnsafe(`
          SELECT "id"
          FROM "profile"."profiles"
          WHERE "user_id" =
            '75000000-0000-4000-8000-000000000002'::uuid
          FOR UPDATE
        `);
        await transaction.$executeRawUnsafe(`
          INSERT INTO "profile"."cvs"
            ("id", "user_id", "title", "type", "file_id", "file_url",
             "media_reference_id", "is_default", "updated_at")
          VALUES
            ('75000000-0000-4000-8000-000000000011',
             '75000000-0000-4000-8000-000000000002',
             'CV committed while revision migration waits',
             'UPLOAD',
             '75000000-0000-4000-8000-000000000111',
             NULL,
             '75000000-0000-4000-8000-000000000211',
             false,
             CURRENT_TIMESTAMP)
        `);
        markRevisionWriterInserted();
        await revisionWriterRelease;
      },
      { timeout: 15_000 },
    );
    await Promise.race([
      revisionWriterInserted,
      revisionWriterCompletion.then(() => {
        throw new Error(
          'Legacy writer committed before the revision migration started',
        );
      }),
    ]);

    const revisionMigration = startMigration(
      '20260827150000_cv_builder_revisions',
    );
    let revisionLockWaitError;
    try {
      await waitForMigrationWriterLock(revisionMigration.child);
    } catch (error) {
      revisionLockWaitError = error;
    } finally {
      releaseRevisionWriter();
    }
    await revisionWriterCompletion;
    await revisionMigration.completion;
    if (revisionLockWaitError) {
      throw revisionLockWaitError;
    }

    const rows = await prisma.$queryRawUnsafe(`
      SELECT "completion_percent", "completion_rule_version"
      FROM "profile"."profiles"
      WHERE "user_id" = '71000000-0000-4000-8000-000000000002'::uuid
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].completion_percent, 50);
    assert.equal(rows[0].completion_rule_version, 1);

    const avatarRows = await prisma.$queryRawUnsafe(`
      SELECT
        "avatar_file_id"::text AS "avatarFileId",
        "avatar_url" AS "avatarUrl",
        "avatar_media_reference_id"::text AS "avatarMediaReferenceId"
      FROM "profile"."profiles"
      WHERE "user_id" = '71000000-0000-4000-8000-000000000002'::uuid
    `);
    assert.deepEqual(avatarRows, [
      {
        avatarFileId: '71000000-0000-4000-8000-000000000005',
        avatarUrl: 'https://media.example.com/avatars/legacy-candidate.jpg',
        avatarMediaReferenceId: null,
      },
    ]);

    const cvRows = await prisma.$queryRawUnsafe(`
      SELECT
        "file_id"::text AS "fileId",
        "file_url" AS "fileUrl",
        "media_reference_id"::text AS "mediaReferenceId",
        "is_default" AS "isDefault",
        "revision_series_id"::text AS "revisionSeriesId",
        "revision_number" AS "revisionNumber",
        "previous_revision_id"::text AS "previousRevisionId"
      FROM "profile"."cvs"
      WHERE "id" = '71000000-0000-4000-8000-000000000006'::uuid
    `);
    assert.deepEqual(cvRows, [
      {
        fileId: '71000000-0000-4000-8000-000000000007',
        fileUrl: 'https://media.example.com/cvs/legacy-candidate.pdf',
        mediaReferenceId: null,
        isDefault: true,
        revisionSeriesId: '71000000-0000-4000-8000-000000000006',
        revisionNumber: 1,
        previousRevisionId: null,
      },
    ]);

    const lineageRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::integer AS "count"
      FROM "profile"."cvs"
      WHERE "revision_series_id" = "id"
        AND "revision_number" = 1
        AND "previous_revision_id" IS NULL
    `);
    const totalCvRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::integer AS "count"
      FROM "profile"."cvs"
    `);
    assert.equal(lineageRows[0].count, totalCvRows[0].count);

    const concurrentBackfillRows = await prisma.$queryRawUnsafe(`
      SELECT
        "revision_series_id"::text AS "revisionSeriesId",
        "revision_number" AS "revisionNumber",
        "previous_revision_id"::text AS "previousRevisionId"
      FROM "profile"."cvs"
      WHERE "id" = '75000000-0000-4000-8000-000000000011'::uuid
    `);
    assert.deepEqual(concurrentBackfillRows, [
      {
        revisionSeriesId: '75000000-0000-4000-8000-000000000011',
        revisionNumber: 1,
        previousRevisionId: null,
      },
    ]);

    const defaultRows = await prisma.$queryRawUnsafe(`
      SELECT "user_id"::text AS "userId", "id"::text AS "cvId"
      FROM "profile"."cvs"
      WHERE "is_default"
      ORDER BY "user_id", "id"
    `);
    assert.deepEqual(defaultRows, [
      {
        userId: '71000000-0000-4000-8000-000000000002',
        cvId: '71000000-0000-4000-8000-000000000006',
      },
      {
        userId: '72000000-0000-4000-8000-000000000002',
        cvId: '72000000-0000-4000-8000-000000000011',
      },
      {
        userId: '73000000-0000-4000-8000-000000000002',
        cvId: '73000000-0000-4000-8000-000000000010',
      },
      {
        userId: '75000000-0000-4000-8000-000000000002',
        cvId: '75000000-0000-4000-8000-000000000010',
      },
    ]);

    const versionRows = await prisma.$queryRawUnsafe(`
      SELECT
        "profile"."user_id"::text AS "userId",
        "profile"."aggregate_version" AS "profileVersion",
        "cv"."aggregate_version" AS "cvVersion"
      FROM "profile"."profiles" AS "profile"
      JOIN "profile"."cvs" AS "cv"
        ON "cv"."user_id" = "profile"."user_id"
       AND "cv"."is_default"
      WHERE "profile"."user_id" IN (
        '71000000-0000-4000-8000-000000000002'::uuid,
        '72000000-0000-4000-8000-000000000002'::uuid,
        '73000000-0000-4000-8000-000000000002'::uuid,
        '75000000-0000-4000-8000-000000000002'::uuid
      )
      ORDER BY "profile"."user_id"
    `);
    assert.deepEqual(versionRows, [
      {
        userId: '71000000-0000-4000-8000-000000000002',
        profileVersion: 2,
        cvVersion: 2,
      },
      {
        userId: '72000000-0000-4000-8000-000000000002',
        profileVersion: 2,
        cvVersion: 2,
      },
      {
        userId: '73000000-0000-4000-8000-000000000002',
        profileVersion: 1,
        cvVersion: 1,
      },
      {
        userId: '75000000-0000-4000-8000-000000000002',
        profileVersion: 2,
        cvVersion: 2,
      },
    ]);

    const triggerRows = await prisma.$queryRawUnsafe(`
      SELECT
        "trigger"."tgdeferrable" AS "deferrable",
        "trigger"."tginitdeferred" AS "initiallyDeferred",
        PG_GET_TRIGGERDEF("trigger"."oid") AS "definition"
      FROM "pg_catalog"."pg_trigger" AS "trigger"
      WHERE "trigger"."tgrelid" = '"profile"."cvs"'::regclass
        AND "trigger"."tgname" = 'cvs_default_invariant_deferred'
        AND NOT "trigger"."tgisinternal"
    `);
    assert.equal(triggerRows.length, 1);
    assert.equal(triggerRows[0].deferrable, true);
    assert.equal(triggerRows[0].initiallyDeferred, true);
    assert.match(triggerRows[0].definition, /CONSTRAINT TRIGGER/i);

    const defaultIndexRows = await prisma.$queryRawUnsafe(`
      SELECT PG_GET_INDEXDEF("index"."indexrelid") AS "definition"
      FROM "pg_catalog"."pg_index" AS "index"
      WHERE "index"."indexrelid" =
        '"profile"."cvs_one_active_default_per_user_key"'::regclass
    `);
    assert.equal(defaultIndexRows.length, 1);
    assert.match(defaultIndexRows[0].definition, /CREATE UNIQUE INDEX/i);
    assert.match(defaultIndexRows[0].definition, /is_default/i);
    assert.match(defaultIndexRows[0].definition, /is_deleted/i);

    await assert.rejects(
      () =>
        prisma.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(`
            UPDATE "profile"."cvs"
            SET "is_default" = false
            WHERE "id" = '72000000-0000-4000-8000-000000000011'::uuid
          `);
          await transaction.$executeRawUnsafe(
            'SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE',
          );
        }),
      /exactly one default/i,
    );

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`
        UPDATE "profile"."cvs"
        SET "is_default" = false
        WHERE "id" = '72000000-0000-4000-8000-000000000011'::uuid
      `);
      await transaction.$executeRawUnsafe(`
        UPDATE "profile"."cvs"
        SET "is_default" = true
        WHERE "id" = '72000000-0000-4000-8000-000000000012'::uuid
      `);
      await transaction.$executeRawUnsafe(
        'SET CONSTRAINTS "profile"."cvs_default_invariant_deferred" IMMEDIATE',
      );
    });

    const switchedDefaults = await prisma.$queryRawUnsafe(`
      SELECT "id"::text AS "cvId"
      FROM "profile"."cvs"
      WHERE "user_id" = '72000000-0000-4000-8000-000000000002'::uuid
        AND "is_default"
    `);
    assert.deepEqual(switchedDefaults, [
      { cvId: '72000000-0000-4000-8000-000000000012' },
    ]);

    await assert.rejects(
      () =>
        prisma.$executeRawUnsafe(`
          UPDATE "profile"."cvs"
          SET "is_default" = true
          WHERE "id" = '72000000-0000-4000-8000-000000000011'::uuid
        `),
    );
    await assert.rejects(
      () =>
        prisma.$executeRawUnsafe(`
          UPDATE "profile"."cvs"
          SET "is_default" = true
          WHERE "id" = '74000000-0000-4000-8000-000000000010'::uuid
        `),
    );

    await prisma.$executeRawUnsafe(`
      UPDATE "profile"."cvs"
      SET
        "is_default" = false,
        "is_deleted" = true,
        "deleted_at" = CURRENT_TIMESTAMP
      WHERE "id" = '71000000-0000-4000-8000-000000000006'::uuid
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE "profile"."cvs"
      SET
        "is_default" = true,
        "is_deleted" = false,
        "deleted_at" = NULL
      WHERE "id" = '71000000-0000-4000-8000-000000000006'::uuid
    `);
    await assert.rejects(
      () =>
        prisma.$executeRawUnsafe(`
          DELETE FROM "profile"."cvs"
          WHERE "id" = '71000000-0000-4000-8000-000000000006'::uuid
        `),
      /hard delete is disabled/i,
    );

    const mediaColumns = await prisma.$queryRawUnsafe(`
      SELECT
        "table_name" AS "tableName",
        "column_name" AS "columnName",
        "is_nullable" AS "isNullable",
        "data_type" AS "dataType"
      FROM "information_schema"."columns"
      WHERE "table_schema" = 'profile'
        AND (
          ("table_name" = 'profiles' AND "column_name" = 'avatar_media_reference_id')
          OR ("table_name" = 'cvs' AND "column_name" IN ('file_url', 'media_reference_id'))
        )
      ORDER BY "table_name", "column_name"
    `);
    assert.deepEqual(mediaColumns, [
      {
        tableName: 'cvs',
        columnName: 'file_url',
        isNullable: 'YES',
        dataType: 'character varying',
      },
      {
        tableName: 'cvs',
        columnName: 'media_reference_id',
        isNullable: 'YES',
        dataType: 'uuid',
      },
      {
        tableName: 'profiles',
        columnName: 'avatar_media_reference_id',
        isNullable: 'YES',
        dataType: 'uuid',
      },
    ]);
    process.stdout.write(
      'Profile completion, Media and CV lifecycle upgrade preservation: OK\n',
    );
  } finally {
    if (canResetSchema) {
      await prisma.$executeRawUnsafe(
        'DROP SCHEMA IF EXISTS "profile" CASCADE',
      );
    }
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
