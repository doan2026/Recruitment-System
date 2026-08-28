import { ConfigService } from '@nestjs/config';
import {
  JOB_EVENT_BASELINE_BATCH_SIZE_DEFAULT,
  JOB_EVENT_BASELINE_BATCH_SIZE_MAXIMUM,
  JOB_EVENT_BASELINE_BATCH_SIZE_MINIMUM,
  JOB_EVENT_BASELINE_MAX_BATCHES_DEFAULT,
  JOB_EVENT_BASELINE_MAX_BATCHES_MAXIMUM,
  JOB_EVENT_BASELINE_MAX_BATCHES_MINIMUM,
  JobEventBaselineOptions,
  JobEventBaselineResult,
  JobEventBaselineService,
} from './job-event-baseline.service';
import { JobEventPublisherService } from './job-event-publisher.service';
import { PrismaService } from './prisma.service';

export const JOB_EVENT_BASELINE_CONFIRMATION = 'JOB_EVENTS_BASELINE_V1';

export interface JobEventBaselineCliOptions
  extends Omit<JobEventBaselineOptions, 'now'> {}

export function parseJobEventBaselineArguments(
  arguments_: readonly string[],
): JobEventBaselineCliOptions {
  let execute = false;
  let dryRun = false;
  let confirmation: string | undefined;
  let batchSize = JOB_EVENT_BASELINE_BATCH_SIZE_DEFAULT;
  let maxBatches = JOB_EVENT_BASELINE_MAX_BATCHES_DEFAULT;
  const seen = new Set<string>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith('--')) throw argumentError();
    if (seen.has(argument)) throw argumentError();
    seen.add(argument);

    switch (argument) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--execute':
        execute = true;
        break;
      case '--confirm':
        confirmation = optionValue(arguments_, ++index);
        break;
      case '--batch-size':
        batchSize = boundedArgument(
          optionValue(arguments_, ++index),
          JOB_EVENT_BASELINE_BATCH_SIZE_MINIMUM,
          JOB_EVENT_BASELINE_BATCH_SIZE_MAXIMUM,
        );
        break;
      case '--max-batches':
        maxBatches = boundedArgument(
          optionValue(arguments_, ++index),
          JOB_EVENT_BASELINE_MAX_BATCHES_MINIMUM,
          JOB_EVENT_BASELINE_MAX_BATCHES_MAXIMUM,
        );
        break;
      default:
        throw argumentError();
    }
  }

  if (
    (execute && dryRun) ||
    (execute && confirmation !== JOB_EVENT_BASELINE_CONFIRMATION) ||
    (!execute && confirmation !== undefined)
  ) {
    throw argumentError();
  }
  return { execute, batchSize, maxBatches };
}

export function jobEventBaselineExitCode(
  result: JobEventBaselineResult,
): number {
  return result.remainingCurrentEvents > 0 || result.stalePublishedJobs > 0
    ? 2
    : 0;
}

export async function runJobEventBaselineCli(
  arguments_: readonly string[],
): Promise<number> {
  const options = parseJobEventBaselineArguments(arguments_);
  const prisma = new PrismaService();
  const publisher = new JobEventPublisherService(
    prisma,
    new ConfigService(),
  );
  const baseline = new JobEventBaselineService(prisma, publisher);

  await prisma.onModuleInit();
  try {
    const counts = await baseline.run(options);
    process.stdout.write(`${JSON.stringify(counts)}\n`);
    return jobEventBaselineExitCode(counts);
  } finally {
    await publisher.onModuleDestroy();
    await prisma.onModuleDestroy();
  }
}

export async function jobEventBaselineMain(
  arguments_: readonly string[],
  run: (arguments_: readonly string[]) => Promise<number> =
    runJobEventBaselineCli,
  writeError: (value: string) => void = (value) => {
    process.stderr.write(value);
  },
): Promise<number> {
  try {
    return await run(arguments_);
  } catch {
    writeError('{"errors":1}\n');
    return 1;
  }
}

function optionValue(arguments_: readonly string[], index: number): string {
  const value = arguments_[index];
  if (value === undefined || value.startsWith('--')) throw argumentError();
  return value;
}

function boundedArgument(
  raw: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^[1-9][0-9]*$/.test(raw)) throw argumentError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw argumentError();
  }
  return value;
}

function argumentError(): Error {
  const error = new Error('JOB_EVENT_BASELINE_ARGUMENTS_INVALID');
  error.name = 'JOB_EVENT_BASELINE_ARGUMENTS_INVALID';
  return error;
}

if (require.main === module) {
  void jobEventBaselineMain(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    });
}
