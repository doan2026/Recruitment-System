import { expiryIntervalMs } from './job-expiry.service';

describe('JOB_EXPIRY_INTERVAL_MS', () => {
  it.each([
    [undefined, 3_600_000],
    ['', 3_600_000],
    ['3600000', 3_600_000],
    [' 120000 ', 120_000],
    ['1000', 60_000],
  ])('%p resolves to %p ms', (raw, expected) => {
    expect(expiryIntervalMs(raw)).toBe(expected);
  });

  it.each(['1h', 'NaN', '-5', '0', '1.5', '9007199254740993'])(
    'fails closed on %p instead of scheduling a 1 ms timer', (raw) => {
      expect(() => expiryIntervalMs(raw)).toThrow('JOB_EXPIRY_INTERVAL_MS');
    },
  );
});
