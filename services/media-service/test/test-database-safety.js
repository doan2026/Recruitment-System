'use strict';

const assertSafeTestDatabase = async (prisma) => {
  if (process.env.ALLOW_MEDIA_SCHEMA_RESET !== 'true') {
    throw new Error(
      'Refusing destructive Media test setup without ALLOW_MEDIA_SCHEMA_RESET=true',
    );
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is required for Media integration tests');
  }
  const parsed = new URL(raw);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      'Refusing destructive Media test setup: database name must end with _test',
    );
  }

  const rows = await prisma.$queryRawUnsafe(
    'SELECT current_database() AS "name"',
  );
  const actualDatabaseName = rows[0]?.name;
  if (
    actualDatabaseName !== databaseName ||
    !actualDatabaseName.endsWith('_test')
  ) {
    throw new Error(
      'Refusing destructive Media test setup: connected database does not match the safe _test URL',
    );
  }
  return databaseName;
};

module.exports = { assertSafeTestDatabase };
