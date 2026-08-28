'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const {
  after,
  before,
  test,
} = require('node:test');
const {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient, NotificationType } = require('@prisma/client');
const { Kafka, logLevel } = require('kafkajs');

const ISSUER = 'https://auth.recruitment.local';
const AUDIENCE = 'recruitment-api';
const APPLICATION_ID = '11000000-0000-4000-8000-000000000001';
const JOB_ID = '21000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '31000000-0000-4000-8000-000000000001';
const RECRUITER_ID = '41000000-0000-4000-8000-000000000001';
const INITIAL_EVENT_ID = '51000000-0000-4000-8000-000000000001';
const PIPELINE_EVENT_ID = '51000000-0000-4000-8000-000000000002';
const LEGACY_EVENT_ID = '51000000-0000-4000-8000-000000000003';
const LEGACY_WITHDRAWN_EVENT_ID =
  '51000000-0000-4000-8000-000000000004';
const HISTORICAL_EVENT_ID = '51000000-0000-4000-8000-000000000005';
const TOPIC = process.env.KAFKA_APPLICATION_TOPIC ?? 'application-events';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const publicJwk = createPublicKey(publicKeyPem).export({ format: 'jwk' });
const keyId = createHash('sha256')
  .update(
    JSON.stringify({ e: publicJwk.e, kty: 'RSA', n: publicJwk.n }),
  )
  .digest('base64url');

process.env.JWT_PUBLIC_KEY = publicKeyPem;
process.env.JWT_PUBLIC_KEY_PATH = '';
process.env.JWT_JWKS_URI = '';
process.env.JWT_ISSUER = ISSUER;
process.env.JWT_AUDIENCE = AUDIENCE;
process.env.NOTIFICATION_CURSOR_HMAC_KEY =
  'notification-integration-cursor-key-000000000001';
process.env.NOTIFICATION_EVENT_MAX_BYTES = '65536';
process.env.NOTIFICATION_APPLICATION_REPLAY_AFTER =
  '2026-08-27T00:00:00.000Z';
process.env.NOTIFICATION_KAFKA_CONSUMER_ENABLED = 'true';
process.env.KAFKA_NOTIFICATION_GROUP_ID =
  `notification-integration-${randomUUID()}`;
process.env.SWAGGER_ENABLED = 'false';

const { AppModule } = require('../dist/app.module');
const { configureApplication } = require('../dist/main');

const prisma = new PrismaClient();
const jwt = new JwtService();
const kafka = new Kafka({
  clientId: 'notification-integration-producer',
  brokers: process.env.KAFKA_BROKERS.split(','),
  logLevel: logLevel.NOTHING,
});
const producer = kafka.producer({ allowAutoTopicCreation: false });
let app;
let baseUrl;

const accessToken = (userId, role = 'CANDIDATE', overrides = {}) =>
  jwt.sign(
    { role, ...(overrides.payload ?? {}) },
    {
      privateKey: privateKeyPem,
      algorithm: 'RS256',
      issuer: overrides.issuer ?? ISSUER,
      audience: overrides.audience ?? AUDIENCE,
      subject: userId,
      jwtid: overrides.jwtid ?? randomUUID(),
      expiresIn: '15m',
      header: { kid: keyId, typ: 'JWT' },
    },
  );

const event = (overrides = {}) => ({
  schema_version: 1,
  aggregate_version: 0,
  event_id: INITIAL_EVENT_ID,
  action: 'STATUS_CHANGED',
  application_id: APPLICATION_ID,
  job_id: JOB_ID,
  job_title: 'Platform Engineer',
  candidate_id: CANDIDATE_ID,
  recruiter_id: RECRUITER_ID,
  actor_id: CANDIDATE_ID,
  from_status: null,
  to_status: 'APPLIED',
  occurred_at: '2040-08-28T13:00:00.000Z',
  ...overrides,
});

const publish = async (payload, key = APPLICATION_ID, timestamp) => {
  await producer.send({
    topic: TOPIC,
    messages: [
      {
        key,
        ...(timestamp ? { timestamp: String(timestamp) } : {}),
        value:
          typeof payload === 'string' ? payload : JSON.stringify(payload),
      },
    ],
  });
};

const request = async (method, path, token) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
};

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
};

before(async () => {
  assert.match(
    process.env.DATABASE_URL,
    /notification_test.*schema=notification/,
    'integration test refuses a non-test database',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "notification"."notification_logs", ' +
      '"notification"."notifications", ' +
      '"notification"."processed_events", ' +
      '"notification"."poison_events", ' +
      '"notification"."device_tokens", ' +
      '"notification"."notification_settings" CASCADE',
  );
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      {
        topic: TOPIC,
        numPartitions: 1,
        replicationFactor: 1,
      },
    ],
  });
  await admin.disconnect();
  await producer.connect();
  // The group intentionally starts at the retained beginning, but records
  // older than the explicit first-rollout cutoff are ledgered without
  // generating a fresh unread inbox item.
  await publish(
    event({ event_id: HISTORICAL_EVENT_ID }),
    APPLICATION_ID,
    Date.parse('2026-08-26T23:59:59.999Z'),
  );
  // Publish before the new group joins. A v1 projection must not lose this
  // backlog even when Application Service starts before Notification Service.
  await publish(event());
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, '0.0.0');
  baseUrl = await app.getUrl();
  await waitFor(async () => {
    const response = await fetch(baseUrl + '/health/ready');
    return response.status === 200;
  }, 'Notification consumer did not become ready');
});

after(async () => {
  await producer.disconnect();
  await app?.close();
  await prisma.$disconnect();
});

test('Kafka duplicate is idempotent and event-id collision is quarantined', async () => {
  const payload = event();
  await publish(payload);
  await publish(payload);
  await waitFor(
    async () =>
      (await prisma.processedEvent.count({
        where: { eventId: INITIAL_EVENT_ID },
      })) === 1 &&
      (await prisma.notification.count({
        where: { sourceEventId: INITIAL_EVENT_ID },
      })) === 1,
    'initial event was not processed exactly once',
  );

  await publish({ ...payload, job_title: 'Tampered title' });
  await waitFor(
    async () =>
      (await prisma.poisonEvent.count({
        where: { errorCode: 'EVENT_ID_COLLISION' },
      })) === 1,
    'event id collision was not quarantined',
  );
  assert.equal(
    await prisma.notification.count({
      where: { sourceEventId: INITIAL_EVENT_ID },
    }),
    1,
  );
  const notification = await prisma.notification.findFirstOrThrow({
    where: { sourceEventId: INITIAL_EVENT_ID },
  });
  assert.ok(
    notification.createdAt < new Date(payload.occurred_at),
    'inbox ordering must use trusted database receive time',
  );
  assert.equal(
    await prisma.processedEvent.count({
      where: { eventId: HISTORICAL_EVENT_ID },
    }),
    1,
    'historical record must be durably ledgered',
  );
  assert.equal(
    await prisma.notification.count({
      where: { sourceEventId: HISTORICAL_EVENT_ID },
    }),
    0,
    'historical record before rollout cutoff must not become unread',
  );
});

test('poison does not block the partition and no raw payload is stored', async () => {
  await publish('{"event_id":');
  await publish(
    event({
      aggregate_version: 1,
      event_id: PIPELINE_EVENT_ID,
      actor_id: RECRUITER_ID,
      from_status: 'APPLIED',
      to_status: 'REVIEWING',
      occurred_at: '2026-08-28T13:01:00.000Z',
    }),
  );
  await waitFor(
    async () =>
      (await prisma.poisonEvent.count({
        where: { errorCode: 'EVENT_JSON_INVALID' },
      })) === 1 &&
      (await prisma.notification.count({
        where: { sourceEventId: PIPELINE_EVENT_ID },
      })) === 1,
    'consumer did not continue after poison',
  );
  const poison = await prisma.poisonEvent.findFirst({
    where: { errorCode: 'EVENT_JSON_INVALID' },
  });
  assert.deepEqual(Object.keys(poison).sort(), [
    'errorCode',
    'eventKeySha256',
    'id',
    'offset',
    'partition',
    'payloadSha256',
    'recordedAt',
    'topic',
  ]);
  assert.match(poison.payloadSha256, /^[0-9a-f]{64}$/);
});

test('legacy rollout event is accepted and creates one safe projection', async () => {
  const legacy = event({
    event_id: LEGACY_EVENT_ID,
    actor_id: RECRUITER_ID,
    aggregate_version: 2,
    from_status: 'REVIEWING',
    to_status: 'INTERVIEW',
    occurred_at: '2026-08-28T13:02:00.000Z',
  });
  delete legacy.schema_version;
  delete legacy.aggregate_version;
  delete legacy.actor_id;
  await publish(legacy);
  await waitFor(
    async () =>
      (await prisma.notification.count({
        where: { sourceEventId: LEGACY_EVENT_ID },
      })) === 1,
    'legacy event was not dual-read',
  );
  const notification = await prisma.notification.findFirst({
    where: { sourceEventId: LEGACY_EVENT_ID },
  });
  assert.deepEqual(Object.keys(notification.payloadJson).sort(), [
    'applicationId',
    'deepLink',
    'jobId',
    'toStatus',
  ]);
  assert.equal(notification.userId, CANDIDATE_ID);

  const withdrawn = event({
    event_id: LEGACY_WITHDRAWN_EVENT_ID,
    actor_id: CANDIDATE_ID,
    aggregate_version: 3,
    from_status: 'INTERVIEW',
    to_status: 'WITHDRAWN',
    occurred_at: '2026-08-28T13:03:00.000Z',
  });
  delete withdrawn.schema_version;
  delete withdrawn.aggregate_version;
  delete withdrawn.actor_id;
  await publish(withdrawn);
  await waitFor(
    async () =>
      (await prisma.notification.count({
        where: { sourceEventId: LEGACY_WITHDRAWN_EVENT_ID },
      })) === 1,
    'legacy withdrawal was not dual-read',
  );
  const withdrawalNotification = await prisma.notification.findFirstOrThrow({
    where: { sourceEventId: LEGACY_WITHDRAWN_EVENT_ID },
  });
  assert.equal(withdrawalNotification.userId, RECRUITER_ID);
});

test('inbox is JWT owner-scoped, private and supports idempotent read', async () => {
  const candidateToken = accessToken(CANDIDATE_ID);
  const recruiterToken = accessToken(RECRUITER_ID, 'RECRUITER');
  const candidateList = await request(
    'GET',
    '/notifications?limit=20',
    candidateToken,
  );
  assert.equal(candidateList.status, 200, JSON.stringify(candidateList.body));
  assert.match(candidateList.headers.get('cache-control'), /private/);
  assert.match(candidateList.headers.get('cache-control'), /no-store/);
  assert.equal(candidateList.headers.get('pragma'), 'no-cache');
  assert.ok(candidateList.body.data.length >= 2);
  assert.ok(
    candidateList.body.data.every(
      (item) => item.payload.applicationId === APPLICATION_ID,
    ),
  );

  const candidateNotification = candidateList.body.data[0];
  const denied = await request(
    'PATCH',
    `/notifications/${candidateNotification.id}/read`,
    recruiterToken,
  );
  assert.equal(denied.status, 404);

  const read = await request(
    'PATCH',
    `/notifications/${candidateNotification.id}/read`,
    candidateToken,
  );
  assert.equal(read.status, 200);
  assert.ok(read.body.data.readAt);
  const readAgain = await request(
    'PATCH',
    `/notifications/${candidateNotification.id}/read`,
    candidateToken,
  );
  assert.equal(readAgain.body.data.readAt, read.body.data.readAt);

  const anonymous = await request('GET', '/notifications', null);
  assert.equal(anonymous.status, 401);
  const wrongAudience = await request(
    'GET',
    '/notifications',
    accessToken(CANDIDATE_ID, 'CANDIDATE', { audience: 'wrong-audience' }),
  );
  assert.equal(wrongAudience.status, 401);
});

test('keyset cursor has no duplicates and cannot cross user scope', async () => {
  const createdAt = new Date('2027-01-01T00:00:00.000Z');
  await prisma.notification.createMany({
    data: [
      '81000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000003',
    ].map((id, index) => ({
      id,
      userId: CANDIDATE_ID,
      type: NotificationType.APPLICATION_STATUS_CHANGED,
      title: `Page item ${index}`,
      body: 'Pagination test',
      payloadJson: { applicationId: APPLICATION_ID },
      sourceTopic: 'integration-pagination',
      sourceEventId: `82000000-0000-4000-8000-00000000000${index + 1}`,
      createdAt,
    })),
  });
  const candidateToken = accessToken(CANDIDATE_ID);
  const first = await request(
    'GET',
    '/notifications?limit=2&type=APPLICATION_STATUS_CHANGED',
    candidateToken,
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.data.length, 2);
  assert.ok(first.body.meta.nextCursor);
  const second = await request(
    'GET',
    `/notifications?limit=2&type=APPLICATION_STATUS_CHANGED&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`,
    candidateToken,
  );
  assert.equal(second.status, 200);
  const ids = [...first.body.data, ...second.body.data].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);

  const recruiterScope = await request(
    'GET',
    `/notifications?limit=2&type=APPLICATION_STATUS_CHANGED&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`,
    accessToken(RECRUITER_ID, 'RECRUITER'),
  );
  assert.equal(recruiterScope.status, 400);
  assert.equal(
    recruiterScope.body.code,
    'NOTIFICATION_CURSOR_SCOPE_MISMATCH',
  );
});

test('read-all uses a database cutoff and returns the exact update count', async () => {
  const candidateToken = accessToken(CANDIDATE_ID);
  const futureUnread = await prisma.notification.count({
    where: {
      userId: CANDIDATE_ID,
      readAt: null,
      createdAt: { gt: new Date() },
    },
  });
  assert.equal(futureUnread, 3);
  const before = await request(
    'GET',
    '/notifications/unread-count',
    candidateToken,
  );
  assert.equal(before.status, 200);
  const readAll = await request(
    'PATCH',
    '/notifications/read-all',
    candidateToken,
  );
  assert.equal(readAll.status, 200);
  assert.equal(
    readAll.body.data.updatedCount,
    before.body.data.count - futureUnread,
  );
  assert.match(readAll.body.data.cutoff, /Z$/);
  const afterCount = await request(
    'GET',
    '/notifications/unread-count',
    candidateToken,
  );
  assert.equal(afterCount.body.data.count, futureUnread);
  assert.equal(
    await prisma.notification.count({
      where: {
        userId: CANDIDATE_ID,
        readAt: null,
        createdAt: { lte: new Date(readAll.body.data.cutoff) },
      },
    }),
    0,
  );
});
