'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { CvEventAction, CvType } = require('@prisma/client');
const { Kafka } = require('kafkajs');
const {
  CvEventPublisherService,
} = require('../dist/profile/cv-event-publisher.service');
const { PrismaService } = require('../dist/prisma/prisma.service');

const kafkaTest = process.env.PROFILE_CV_EVENT_KAFKA_INTEGRATION === '1'
  ? test
  : test.skip;
const broker = process.env.KAFKA_BROKERS ?? 'kafka-test:9092';
const payloadFields = [
  'event_id',
  'action',
  'cv_id',
  'candidate_id',
  'file_id',
  'cv_type',
  'occurred_at',
  'schema_version',
  'aggregate_version',
].sort();

const config = (topic) => {
  const values = {
    CV_EVENT_PUBLISHER_ENABLED: 'true',
    KAFKA_BROKERS: broker,
    KAFKA_CV_TOPIC: topic,
    CV_EVENT_OUTBOX_BATCH_SIZE: '10',
    CV_EVENT_OUTBOX_POLL_INTERVAL_MS: '60000',
    CV_EVENT_OUTBOX_LEASE_MS: '30000',
    CV_EVENT_OUTBOX_RETRY_BASE_MS: '100',
    CV_EVENT_OUTBOX_RETRY_MAX_MS: '1000',
  };
  return { get: (key) => values[key] };
};

const cvSnapshot = ({
  cvId,
  candidateId,
  fileId,
  aggregateVersion,
  isDeleted,
}) => ({
  id: cvId,
  userId: candidateId,
  title: 'Kafka integration CV',
  type: CvType.UPLOAD,
  fileId,
  fileUrl: null,
  mediaReferenceId: randomUUID(),
  templateId: null,
  contentJson: null,
  contentSchemaVersion: null,
  revisionSeriesId: cvId,
  revisionNumber: 1,
  previousRevisionId: null,
  aggregateVersion,
  isDefault: !isDeleted,
  isDeleted,
  firstUsedAt: null,
  deletedAt: isDeleted ? new Date() : null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

kafkaTest(
  'CV outbox publishes exact ordered v1 events once through Kafka 3.8',
  { timeout: 60_000 },
  async () => {
    const topic = `cv-events-profile-it-${Date.now()}`;
    const kafka = new Kafka({
      clientId: 'profile-cv-outbox-integration',
      brokers: [broker],
    });
    const admin = kafka.admin();
    const consumer = kafka.consumer({
      groupId: `profile-cv-outbox-integration-${randomUUID()}`,
    });
    const prisma = new PrismaService();
    const publisher = new CvEventPublisherService(prisma, config(topic));
    let consumerRun;

    await prisma.onModuleInit();
    try {
      await prisma.cvEventOutbox.deleteMany();
      await admin.connect();
      try {
        await admin.createTopics({
          waitForLeaders: true,
          topics: [{
            topic,
            numPartitions: 3,
            replicationFactor: 1,
          }],
        });
      } finally {
        await admin.disconnect();
      }

      const received = [];
      let resolveMessages;
      const allMessages = new Promise((resolve) => {
        resolveMessages = resolve;
      });
      let resolveGroupJoin;
      const groupJoined = new Promise((resolve) => {
        resolveGroupJoin = resolve;
      });

      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });
      const unsubscribe = consumer.on(
        consumer.events.GROUP_JOIN,
        () => {
          unsubscribe();
          resolveGroupJoin();
        },
      );
      consumerRun = consumer.run({
        eachMessage: async ({ topic: messageTopic, message }) => {
          received.push({
            topic: messageTopic,
            key: message.key?.toString() ?? '',
            payload: JSON.parse(message.value?.toString() ?? '{}'),
          });
          if (received.length === 2) resolveMessages();
        },
      });
      await Promise.race([
        groupJoined,
        timeout(15_000, 'Kafka consumer did not join its group'),
      ]);

      const cvId = randomUUID();
      const candidateId = randomUUID();
      const fileId = randomUUID();
      const active = cvSnapshot({
        cvId,
        candidateId,
        fileId,
        aggregateVersion: 1,
        isDeleted: false,
      });
      const deactivated = {
        ...cvSnapshot({
          cvId,
          candidateId,
          fileId,
          aggregateVersion: 2,
          isDeleted: true,
        }),
        mediaReferenceId: active.mediaReferenceId,
        createdAt: active.createdAt,
      };

      await prisma.$transaction(async (transaction) => {
        await publisher.append(
          transaction,
          active,
          CvEventAction.UPSERTED,
        );
        await publisher.append(
          transaction,
          deactivated,
          CvEventAction.DEACTIVATED,
        );
      });

      const pending = await prisma.cvEventOutbox.findMany({
        where: { cvId },
        orderBy: { aggregateVersion: 'asc' },
      });
      assert.equal(pending.length, 2);
      assert.deepEqual(
        pending.map((event) => event.aggregateVersion),
        [1, 2],
      );

      assert.equal(await publisher.flushPending(), 2);
      await Promise.race([
        allMessages,
        timeout(15_000, 'Kafka did not deliver both CV events'),
      ]);

      assert.deepEqual(received.map((event) => event.topic), [topic, topic]);
      assert.deepEqual(received.map((event) => event.key), [cvId, cvId]);
      assert.deepEqual(
        received.map((event) => event.payload.aggregate_version),
        [1, 2],
      );
      assert.deepEqual(
        received.map((event) => event.payload.action),
        ['UPSERTED', 'DEACTIVATED'],
      );
      assert.deepEqual(
        received.map((event) => event.payload),
        pending.map((event) => event.payload),
      );
      for (const event of received) {
        assert.deepEqual(Object.keys(event.payload).sort(), payloadFields);
        assert.equal(event.payload.cv_id, cvId);
        assert.equal(event.payload.candidate_id, candidateId);
        assert.equal(event.payload.file_id, fileId);
        assert.equal(event.payload.cv_type, 'UPLOAD');
        assert.equal(event.payload.schema_version, 1);
        assert.match(
          event.payload.occurred_at,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
      }

      const published = await prisma.cvEventOutbox.findMany({
        where: { cvId },
        orderBy: { aggregateVersion: 'asc' },
      });
      assert.ok(published.every((event) => event.publishedAt instanceof Date));
      assert.deepEqual(published.map((event) => event.attempts), [1, 1]);
      const terminalTimestamps = published.map((event) =>
        event.publishedAt.toISOString());

      assert.equal(await publisher.flushPending(), 0);
      assert.equal(await publisher.flushPending(), 0);
      await delay(500);
      assert.equal(received.length, 2);
      const afterRetry = await prisma.cvEventOutbox.findMany({
        where: { cvId },
        orderBy: { aggregateVersion: 'asc' },
      });
      assert.deepEqual(afterRetry.map((event) => event.attempts), [1, 1]);
      assert.deepEqual(
        afterRetry.map((event) => event.publishedAt.toISOString()),
        terminalTimestamps,
      );
    } finally {
      await consumer.stop().catch(() => undefined);
      await consumerRun?.catch(() => undefined);
      await consumer.disconnect().catch(() => undefined);
      await publisher.onModuleDestroy();
      await prisma.cvEventOutbox.deleteMany().catch(() => undefined);
      await prisma.onModuleDestroy();
    }
  },
);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timeout(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}
