// Prisma's generated module can load schema-relative .env during import.
// Keep each unit-test sandbox on its explicit fixtures without mutating the file.
const environmentBeforePrisma = { ...process.env };
require('@prisma/client');
for (const key of Object.keys(process.env)) {
  if (!(key in environmentBeforePrisma)) delete process.env[key];
}
Object.assign(process.env, environmentBeforePrisma);
