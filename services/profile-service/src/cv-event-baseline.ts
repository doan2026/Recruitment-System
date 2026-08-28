import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CvEventBaselineModule } from './cv-event-baseline.module';
import {
  CV_EVENT_BASELINE_DEFAULT_BATCH_SIZE,
  CV_EVENT_BASELINE_DEFAULT_MAX_BATCHES,
  CV_EVENT_BASELINE_MAX_BATCHES,
  CV_EVENT_BASELINE_MAX_BATCH_SIZE,
  CvEventBaselineOptions,
  CvEventBaselineService,
  CvEventBaselineSummary,
} from './profile/cv-event-baseline.service';

const EXECUTION_CONFIRMATION = 'CV_EVENTS_BASELINE_V1';

interface ParsedArguments extends CvEventBaselineOptions {}

const fatalSummary = (): CvEventBaselineSummary & {
  readonly fatalErrors: number;
} => ({
  activeLegacyCvCount: 0,
  batchesProcessed: 0,
  candidatesScanned: 0,
  mediaVerified: 0,
  mediaErrors: 0,
  eventsAppended: 0,
  concurrentlyCovered: 0,
  stateChanged: 0,
  eligibleRemaining: 0,
  fatalErrors: 1,
});

export function parseCvEventBaselineArguments(
  arguments_: readonly string[],
): ParsedArguments {
  let execute = false;
  let confirmation: string | undefined;
  let batchSize = CV_EVENT_BASELINE_DEFAULT_BATCH_SIZE;
  let maxBatches = CV_EVENT_BASELINE_DEFAULT_MAX_BATCHES;
  const seen = new Set<string>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--execute') {
      requireUnique(seen, '--execute');
      execute = true;
      continue;
    }
    if (argument === '--confirm') {
      requireUnique(seen, '--confirm');
      confirmation = requireValue(arguments_, ++index, '--confirm');
      continue;
    }
    if (argument === '--batch-size') {
      requireUnique(seen, '--batch-size');
      batchSize = boundedInteger(
        requireValue(arguments_, ++index, '--batch-size'),
        '--batch-size',
        CV_EVENT_BASELINE_MAX_BATCH_SIZE,
      );
      continue;
    }
    if (argument === '--max-batches') {
      requireUnique(seen, '--max-batches');
      maxBatches = boundedInteger(
        requireValue(arguments_, ++index, '--max-batches'),
        '--max-batches',
        CV_EVENT_BASELINE_MAX_BATCHES,
      );
      continue;
    }
    throw new Error('Unknown CV event baseline argument');
  }

  if (
    (execute && confirmation !== EXECUTION_CONFIRMATION) ||
    (!execute && confirmation !== undefined)
  ) {
    throw new Error('CV event baseline execution confirmation is invalid');
  }
  return { execute, batchSize, maxBatches };
}

export async function runCvEventBaselineCli(
  arguments_: readonly string[],
): Promise<number> {
  let application: INestApplicationContext | undefined;
  try {
    const options = parseCvEventBaselineArguments(arguments_);
    // The one-shot command only appends transactional intents. A normally
    // deployed Profile replica owns dispatch and its retry/lease lifecycle.
    process.env.CV_EVENT_PUBLISHER_ENABLED = 'false';
    application = await NestFactory.createApplicationContext(
      CvEventBaselineModule,
      { logger: false },
    );
    const summary = await application
      .get(CvEventBaselineService)
      .run(options);
    process.stdout.write(JSON.stringify({ ...summary, fatalErrors: 0 }) + '\n');
    return summary.eligibleRemaining > 0 || summary.mediaErrors > 0 ? 1 : 0;
  } catch {
    process.stdout.write(JSON.stringify(fatalSummary()) + '\n');
    return 2;
  } finally {
    await application?.close().catch(() => undefined);
  }
}

function requireUnique(seen: Set<string>, name: string): void {
  if (seen.has(name)) throw new Error('Duplicate CV event baseline argument');
  seen.add(name);
}

function requireValue(
  arguments_: readonly string[],
  index: number,
  name: string,
): string {
  const value = arguments_[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function boundedInteger(
  value: string,
  name: string,
  maximum: number,
): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} is outside its allowed range`);
  }
  return parsed;
}

if (require.main === module) {
  void runCvEventBaselineCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
