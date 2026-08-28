'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CvDeletionService } = require(
  '../dist/profile/cv-deletion.service',
);

test('USED terminal convergence keys on stable firstUsedAt, not a later live application count', () => {
  const service = new CvDeletionService(
    {},
    {},
    {},
    {},
    { append: async () => undefined, wake: () => undefined },
    { get: () => undefined },
  );
  const firstUsedAt = new Date('2026-08-27T03:00:00.000Z');
  const stored = {
    firstUsedAt,
    applicationCount: 1n,
  };

  assert.doesNotThrow(() =>
    service.assertSameUsedDecision(
      stored,
      new Date(firstUsedAt),
      99,
    ),
  );
  assert.throws(() =>
    service.assertSameUsedDecision(
      stored,
      new Date('2026-08-27T03:00:00.001Z'),
      1,
    ),
  );
});
