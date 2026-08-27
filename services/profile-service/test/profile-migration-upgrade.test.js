'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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

    executeMigration('20260827010000_profile_completion_rule');
    executeMigration('20260827130000_profile_media_integration');

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
        "media_reference_id"::text AS "mediaReferenceId"
      FROM "profile"."cvs"
      WHERE "id" = '71000000-0000-4000-8000-000000000006'::uuid
    `);
    assert.deepEqual(cvRows, [
      {
        fileId: '71000000-0000-4000-8000-000000000007',
        fileUrl: 'https://media.example.com/cvs/legacy-candidate.pdf',
        mediaReferenceId: null,
      },
    ]);

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
    process.stdout.write('Profile completion and Media upgrade preservation: OK\n');
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
