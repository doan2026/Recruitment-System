import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

const read = (path) =>
  readFileSync(resolve(repositoryRoot, path), 'utf8');

const bracedBlock = (source, marker) => {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing block: ${marker}`);
  const openingBrace = source.indexOf('{', markerIndex);
  assert.notEqual(openingBrace, -1, `Missing opening brace: ${marker}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(markerIndex, index + 1);
  }

  assert.fail(`Missing closing brace: ${marker}`);
};

const yamlService = (source, name) => {
  const pattern = new RegExp(
    `^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z0-9][A-Za-z0-9_-]*:|\\Z)`,
    'm',
  );
  const match = source.match(pattern);
  assert.ok(match, `Missing Compose service: ${name}`);
  return match[0];
};

const nginx = read('infra/nginx/nginx.conf');
const logFormat = nginx.match(
  /log_format candidate_data_no_query[\s\S]*?;/,
)?.[0];
assert.ok(logFormat, 'Missing query-free private-data log format');
assert.match(logFormat, /\$uri/);
assert.doesNotMatch(logFormat, /\$request(?:\s|\")|\$request_uri|\$args|\$http_referer/);

for (const marker of [
  'location = /notifications {',
  'location /notifications/ {',
]) {
  const block = bracedBlock(nginx, marker);
  assert.match(block, /candidate_data_no_query;/);
  assert.match(block, /Cache-Control "private, no-store" always;/);
  assert.match(block, /Pragma "no-cache" always;/);
  assert.match(block, /Vary "Authorization" always;/);
  assert.match(block, /proxy_set_header X-Internal-Api-Key "";/);
  assert.match(block, /proxy_set_header X-Internal-Service "";/);
  assert.match(block, /proxy_pass http:\/\/notification;/);
  assert.doesNotMatch(block, /proxy_pass http:\/\/notification\//);
}

const compose = read('docker-compose.yml');
const migration = yamlService(compose, 'notification-migrate');
assert.match(migration, /target: build/);
assert.match(migration, /schema=notification/);
assert.match(migration, /user: node/);
assert.match(migration, /condition: service_healthy/);
assert.match(migration, /prisma:migrate:deploy/);

const runtime = yamlService(compose, 'notification-service');
assert.match(runtime, /target: runtime/);
assert.match(runtime, /KAFKA_APPLICATION_TOPIC/);
assert.match(runtime, /KAFKA_NOTIFICATION_GROUP_ID/);
assert.match(runtime, /NOTIFICATION_KAFKA_CONSUMER_ENABLED/);
assert.match(runtime, /NOTIFICATION_EVENT_MAX_BYTES/);
assert.match(runtime, /NOTIFICATION_APPLICATION_REPLAY_AFTER/);
assert.match(runtime, /NOTIFICATION_CURSOR_HMAC_KEY/);
assert.match(runtime, /JWT_JWKS_URI: ""/);
assert.doesNotMatch(runtime, /JWT_JWKS_URI: http:/);
assert.match(runtime, /JWT_PUBLIC_KEY_PATH: \/run\/secrets\/jwt-public\.pem/);
assert.match(runtime, /JWT_ISSUER/);
assert.match(runtime, /JWT_AUDIENCE/);
assert.match(runtime, /source: jwt-public-key/);
assert.match(
  runtime,
  /notification-migrate:\n\s+condition: service_completed_successfully/,
);
assert.match(
  runtime,
  /kafka-init:\n\s+condition: service_completed_successfully/,
);
assert.match(runtime, /http:\/\/127\.0\.0\.1:3000\/health\/ready/);

const dockerfile = read('services/notification-service/Dockerfile');
assert.match(dockerfile, /FROM node:24-alpine AS build/);
assert.match(dockerfile, /FROM node:24-alpine AS runtime/);
assert.match(dockerfile, /FROM build AS test/);
assert.equal(
  dockerfile.match(/RUN npm ci(?: --omit=dev)?/g)?.length,
  2,
  'Build and runtime stages must both use npm ci',
);
assert.match(dockerfile, /USER node/);
assert.match(dockerfile, /http:\/\/127\.0\.0\.1:3000\/health\/ready/);
assert.ok(
  existsSync(
    resolve(repositoryRoot, 'services/notification-service/package-lock.json'),
  ),
  'Notification package-lock.json is required for npm ci',
);
const dockerignore = read('services/notification-service/.dockerignore');
assert.match(dockerignore, /^node_modules$/m);
assert.match(dockerignore, /^dist$/m);
assert.match(dockerignore, /^\.env\.\*$/m);
assert.match(dockerignore, /^!\.env\.example$/m);

console.log('Notification infrastructure static checks passed.');
