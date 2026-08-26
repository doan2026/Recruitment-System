'use strict';

const assertSafeTestDatabase = async (prisma) => {
  if (process.env.ALLOW_PROFILE_SCHEMA_RESET !== 'true') {
    throw new Error(
      'Refusing destructive tests without ALLOW_PROFILE_SCHEMA_RESET=true',
    );
  }

  const databases = await prisma.$queryRawUnsafe(
    'SELECT current_database() AS "name"',
  );
  const databaseName = databases[0]?.name;
  if (typeof databaseName !== 'string' || !databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing destructive tests in non-test database: ${databaseName ?? 'unknown'}`,
    );
  }
};

module.exports = {
  assertSafeTestDatabase,
};
