import {
  JOB_EVENT_BASELINE_CONFIRMATION,
  jobEventBaselineMain,
  jobEventBaselineExitCode,
  parseJobEventBaselineArguments,
} from './job-event-baseline.main';
import { JobEventBaselineResult } from './job-event-baseline.service';

describe('Job event baseline CLI', () => {
  it('defaults to a bounded dry-run', () => {
    expect(parseJobEventBaselineArguments([])).toEqual({
      execute: false,
      batchSize: 100,
      maxBatches: 1,
    });
    expect(parseJobEventBaselineArguments(['--dry-run'])).toEqual({
      execute: false,
      batchSize: 100,
      maxBatches: 1,
    });
  });

  it('requires the exact confirmation token before enabling writes', () => {
    expect(parseJobEventBaselineArguments([
      '--execute',
      '--confirm',
      JOB_EVENT_BASELINE_CONFIRMATION,
      '--batch-size',
      '500',
      '--max-batches',
      '10000',
    ])).toEqual({
      execute: true,
      batchSize: 500,
      maxBatches: 10_000,
    });
  });

  it.each([
    ['positional'],
    ['--unknown'],
    ['--execute'],
    ['--execute', '--confirm', 'WRONG'],
    ['--confirm', JOB_EVENT_BASELINE_CONFIRMATION],
    ['--dry-run', '--execute', '--confirm', JOB_EVENT_BASELINE_CONFIRMATION],
    ['--dry-run', '--dry-run'],
    ['--batch-size'],
    ['--batch-size', '0'],
    ['--batch-size', '501'],
    ['--batch-size', '1e2'],
    ['--batch-size=100'],
    ['--max-batches', '0'],
    ['--max-batches', '10001'],
  ])('fails closed for unsafe arguments: %j', (...arguments_) => {
    expect(() => parseJobEventBaselineArguments(arguments_)).toThrow(
      'JOB_EVENT_BASELINE_ARGUMENTS_INVALID',
    );
  });

  it('returns nonzero only for remaining or stale source rows', () => {
    expect(jobEventBaselineExitCode(counts())).toBe(0);
    expect(jobEventBaselineExitCode(counts({
      remainingCurrentEvents: 1,
    }))).toBe(2);
    expect(jobEventBaselineExitCode(counts({
      stalePublishedJobs: 1,
    }))).toBe(2);
  });

  it('reports only an error count when startup fails', async () => {
    const sensitive = 'DATABASE_URL=postgresql://secret@example.invalid/job';
    const output: string[] = [];

    const exitCode = await jobEventBaselineMain(
      ['--dry-run'],
      async () => {
        throw new Error(sensitive);
      },
      (value) => output.push(value),
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual(['{"errors":1}\n']);
    expect(output.join('')).not.toContain(sensitive);
  });
});

function counts(
  overrides: Partial<JobEventBaselineResult> = {},
): JobEventBaselineResult {
  return {
    totalJobs: 0,
    stalePublishedJobs: 0,
    missingCurrentEventsBefore: 0,
    selectedJobs: 0,
    insertedEvents: 0,
    processedBatches: 0,
    remainingCurrentEvents: 0,
    pendingOutboxEvents: 0,
    ...overrides,
  };
}
