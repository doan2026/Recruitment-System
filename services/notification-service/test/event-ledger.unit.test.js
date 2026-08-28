'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Prisma } = require('@prisma/client');
const {
  NotificationEventLedgerService,
} = require('../dist/events/notification-event-ledger.service');

test('non-ledger P2002 remains transient and must not be committed as poison', async () => {
  const uniqueError = new Prisma.PrismaClientKnownRequestError(
    'notification uniqueness conflict',
    { code: 'P2002', clientVersion: '5.22.0' },
  );
  const prisma = {
    $transaction: async () => {
      throw uniqueError;
    },
    processedEvent: {
      findUnique: async () => null,
    },
  };
  const ledger = new NotificationEventLedgerService(prisma);
  const record = {
    topic: 'interview-events',
    partition: 0,
    offset: '1',
    timestamp: String(Date.now()),
    key: Buffer.from('10000000-0000-4000-8000-000000000001'),
    value: Buffer.from('{}'),
  };

  await assert.rejects(
    ledger.process(
      record,
      {
        schemaVersion: 1,
        eventId: '50000000-0000-4000-8000-000000000001',
        eventKey: '10000000-0000-4000-8000-000000000001',
      },
      () => [],
      0,
    ),
    (error) => error === uniqueError,
  );
});
