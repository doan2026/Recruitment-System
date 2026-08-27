'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const {
  MediaCleanupScheduler,
} = require('../dist/media/media-maintenance.service');

const scheduler = (values = {}, maintenance = {}) =>
  new MediaCleanupScheduler(
    new ConfigService(values),
    {
      tryAcquireScheduledCycle: async () => null,
      runOnce: async () => ({}),
      ...maintenance,
    },
  );

test('cleanup scheduler validates bounded fail-fast configuration', () => {
  assert.doesNotThrow(() =>
    scheduler({ MEDIA_CLEANUP_ENABLED: 'false' }).assertConfiguration(),
  );
  assert.doesNotThrow(() =>
    scheduler({
      MEDIA_CLEANUP_ENABLED: 'true',
      MEDIA_CLEANUP_INTERVAL_SECONDS: '300',
      MEDIA_CLEANUP_BATCH_SIZE: '5',
    }).assertConfiguration(),
  );
  assert.throws(
    () =>
      scheduler({
        MEDIA_CLEANUP_ENABLED: 'sometimes',
      }).assertConfiguration(),
    /must be true or false/,
  );
  assert.throws(
    () =>
      scheduler({
        MEDIA_CLEANUP_ENABLED: 'true',
        MEDIA_CLEANUP_BATCH_SIZE: '1000',
      }).assertConfiguration(),
    /MEDIA_CLEANUP_BATCH_SIZE/,
  );
  assert.throws(
    () =>
      scheduler({
        MEDIA_CLEANUP_ENABLED: 'true',
        MEDIA_CLEANUP_LEASE_SECONDS: '60',
        MEDIA_CLEANUP_PROVIDER_TIMEOUT_SECONDS: '60',
      }).assertConfiguration(),
    /must cover provider timeout/,
  );
  assert.throws(
    () =>
      scheduler({
        MEDIA_CLEANUP_ENABLED: 'true',
        MEDIA_CLEANUP_LEASE_SECONDS: '70',
        MEDIA_CLEANUP_PROVIDER_TIMEOUT_SECONDS: '20',
      }).assertConfiguration(),
    /7x timeout plus 10 seconds/,
  );
});

test('disabled cleanup scheduler starts and stops without scheduling work', async () => {
  const instance = scheduler({ MEDIA_CLEANUP_ENABLED: 'false' });
  instance.assertConfiguration();
  instance.onApplicationBootstrap();
  await instance.onApplicationShutdown();
});

test('cleanup scheduler aborts the active cycle when heartbeat loses its lease', async () => {
  let observedSignal;
  let completedCycles = 0;
  const instance = scheduler(
    {},
    {
      tryAcquireScheduledCycle: async () => 7,
      renewScheduledCycle: async () => false,
      completeScheduledCycle: async () => {
        completedCycles += 1;
        return true;
      },
      runOnce: async (_options, execution) => {
        observedSignal = execution.signal;
        await new Promise((resolve) => {
          execution.signal.addEventListener('abort', resolve, {
            once: true,
          });
        });
        return { cycleLeaseLost: true };
      },
    },
  );
  instance.configuration = {
    enabled: true,
    intervalMs: 30_000,
    cycleLeaseMs: 300_000,
    startupJitterMs: 0,
    maintenance: {},
  };
  instance.heartbeatIntervalMs = () => 5;
  instance.schedule = () => {};

  const heartbeatKeepAlive = setTimeout(() => {}, 1000);
  try {
    await instance.tick();
  } finally {
    clearTimeout(heartbeatKeepAlive);
  }

  assert.equal(observedSignal.aborted, true);
  assert.equal(completedCycles, 0);
});

test('cleanup scheduler watchdog aborts before a hanging heartbeat lease expires', async () => {
  let observedSignal;
  let completedCycles = 0;
  const instance = scheduler(
    {},
    {
      tryAcquireScheduledCycle: async () => 9,
      renewScheduledCycle: async () => new Promise(() => {}),
      completeScheduledCycle: async () => {
        completedCycles += 1;
        return true;
      },
      runOnce: async (_options, execution) => {
        observedSignal = execution.signal;
        await new Promise((resolve) => {
          execution.signal.addEventListener('abort', resolve, {
            once: true,
          });
        });
        return { cycleLeaseLost: true };
      },
    },
  );
  instance.configuration = {
    enabled: true,
    intervalMs: 30_000,
    cycleLeaseMs: 1100,
    startupJitterMs: 0,
    maintenance: {},
  };
  instance.heartbeatIntervalMs = () => 5;
  instance.schedule = () => {};

  const watchdogKeepAlive = setTimeout(() => {}, 2000);
  try {
    await instance.tick();
  } finally {
    clearTimeout(watchdogKeepAlive);
  }

  assert.equal(observedSignal.aborted, true);
  assert.equal(completedCycles, 0);
});

test('cleanup scheduler aborts a hanging heartbeat when cycle work throws', async () => {
  let heartbeatStarted;
  const started = new Promise((resolve) => {
    heartbeatStarted = resolve;
  });
  let completedCycles = 0;
  const instance = scheduler(
    {},
    {
      tryAcquireScheduledCycle: async () => 11,
      renewScheduledCycle: async () => {
        heartbeatStarted();
        return new Promise(() => {});
      },
      completeScheduledCycle: async () => {
        completedCycles += 1;
        return true;
      },
      runOnce: async () => {
        await started;
        throw new Error('simulated cycle failure');
      },
    },
  );
  instance.configuration = {
    enabled: true,
    intervalMs: 30_000,
    cycleLeaseMs: 10_000,
    startupJitterMs: 0,
    maintenance: {},
  };
  instance.heartbeatIntervalMs = () => 5;
  instance.schedule = () => {};

  await Promise.race([
    instance.tick(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('scheduler tick remained blocked')),
        500,
      ),
    ),
  ]);

  assert.equal(completedCycles, 0);
});
