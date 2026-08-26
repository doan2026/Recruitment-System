import { JobIndexingService } from './job-indexing.service';

interface DrainHarness {
  batchSize: number;
  stopping: boolean;
  redisCommandTimeoutMs: number;
  claimNext: jest.Mock;
  dispatch: jest.Mock;
  releaseClaimForShutdown: jest.Mock;
  releaseForRetry: jest.Mock;
  resetQueue: jest.Mock;
  logger: { warn: jest.Mock };
}

describe('JobIndexingService shutdown', () => {
  it('does not claim another durable intent after shutdown starts', async () => {
    const sync = {
      jobId: '11111111-1111-4111-8111-111111111111',
      aggregateVersion: 1,
      generation: 1,
      dispatchAttempts: 1,
    };
    const harness: DrainHarness = {
      batchSize: 100,
      stopping: false,
      redisCommandTimeoutMs: 1_000,
      claimNext: jest.fn().mockResolvedValue(sync),
      dispatch: jest.fn(),
      releaseClaimForShutdown: jest.fn(),
      releaseForRetry: jest.fn(),
      resetQueue: jest.fn(),
      logger: { warn: jest.fn() },
    };
    harness.dispatch.mockImplementation(async () => {
      harness.stopping = true;
    });
    const drain = (JobIndexingService.prototype as unknown as {
      drain(this: DrainHarness): Promise<number>;
    }).drain;

    await expect(drain.call(harness)).resolves.toBe(1);
    expect(harness.claimNext).toHaveBeenCalledTimes(1);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.releaseClaimForShutdown).not.toHaveBeenCalled();
  });

  it('releases an in-flight claim when shutdown starts while claiming',
  async () => {
    const sync = {
      jobId: '22222222-2222-4222-8222-222222222222',
      aggregateVersion: 2,
      generation: 3,
      dispatchAttempts: 1,
    };
    let resolveClaim!: (claimed: typeof sync) => void;
    const pendingClaim = new Promise<typeof sync>((resolve) => {
      resolveClaim = resolve;
    });
    const harness: DrainHarness = {
      batchSize: 100,
      stopping: false,
      redisCommandTimeoutMs: 1_000,
      claimNext: jest.fn().mockReturnValue(pendingClaim),
      dispatch: jest.fn(),
      releaseClaimForShutdown: jest.fn().mockResolvedValue(undefined),
      releaseForRetry: jest.fn(),
      resetQueue: jest.fn(),
      logger: { warn: jest.fn() },
    };
    const drain = (JobIndexingService.prototype as unknown as {
      drain(this: DrainHarness): Promise<number>;
    }).drain;

    const draining = drain.call(harness);
    expect(harness.claimNext).toHaveBeenCalledTimes(1);
    harness.stopping = true;
    resolveClaim(sync);

    await expect(draining).resolves.toBe(0);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.releaseClaimForShutdown).toHaveBeenCalledTimes(1);
    expect(harness.releaseClaimForShutdown).toHaveBeenCalledWith(sync);
  });
});
interface ValidatedIndexFixture {
  concreteIndex: string;
  indexUuid: string;
  baselineComplete: boolean;
}

interface IndexBootstrapHarness {
  index: string;
  elastic: {
    indices: {
      exists: jest.Mock;
      create: jest.Mock;
    };
  };
  validateIndexMapping: jest.Mock;
  prepareBaseline: jest.Mock;
}

interface BaselineHarness {
  searchReady: boolean;
  baselineIndex?: string;
  baselineIndexUuid?: string;
  baselineScanComplete: boolean;
  reindexAll: jest.Mock;
  refreshBaselineReadiness: jest.Mock;
  logger: { log: jest.Mock };
}

interface MappingFieldFixture {
  type: string;
  analyzer?: string;
  index?: boolean;
  doc_values?: boolean;
  fields?: Record<string, MappingFieldFixture>;
}

interface MappingFixture {
  dynamic: string;
  _meta: Record<string, unknown>;
  properties: Record<string, MappingFieldFixture>;
}

interface AnalyzerFixture {
  analyzer: {
    vietnamese_text: {
      type: string;
      tokenizer: string;
      filter: string[];
      char_filter?: string[];
    };
  };
}

interface MappingValidationHarness {
  index: string;
  elastic: {
    indices: {
      getMapping: jest.Mock;
      getSettings: jest.Mock;
    };
  };
}

describe('JobIndexingService index bootstrap', () => {
  it('prepares a baseline when a compatible index already exists', async () => {
    const validated: ValidatedIndexFixture = {
      concreteIndex: 'jobs-v3-000001',
      indexUuid: 'index-uuid-000001',
      baselineComplete: false,
    };
    const harness: IndexBootstrapHarness = {
      index: 'jobs-read',
      elastic: {
        indices: {
          exists: jest.fn().mockResolvedValue(true),
          create: jest.fn(),
        },
      },
      validateIndexMapping: jest.fn().mockResolvedValue(validated),
      prepareBaseline: jest.fn().mockResolvedValue(undefined),
    };
    const createIndexIfMissing = (
      JobIndexingService.prototype as unknown as {
        createIndexIfMissing(this: IndexBootstrapHarness): Promise<void>;
      }
    ).createIndexIfMissing;

    await expect(createIndexIfMissing.call(harness)).resolves.toBeUndefined();

    expect(harness.elastic.indices.exists).toHaveBeenCalledWith({
      index: 'jobs-read',
    });
    expect(harness.elastic.indices.create).not.toHaveBeenCalled();
    expect(harness.validateIndexMapping).toHaveBeenCalledTimes(1);
    expect(harness.prepareBaseline).toHaveBeenCalledWith(validated);
  });

  it('keeps baseline unready after a scan failure and can retry', async () => {
    const scanError = new Error('controlled baseline scan failure');
    const validated: ValidatedIndexFixture = {
      concreteIndex: 'jobs-v3-000001',
      indexUuid: 'index-uuid-000001',
      baselineComplete: false,
    };
    const harness: BaselineHarness = {
      searchReady: true,
      baselineIndex: 'stale-index',
      baselineScanComplete: true,
      reindexAll: jest.fn()
        .mockRejectedValueOnce(scanError)
        .mockResolvedValueOnce(0),
      refreshBaselineReadiness: jest.fn().mockResolvedValue(undefined),
      logger: { log: jest.fn() },
    };
    const prepareBaseline = (
      JobIndexingService.prototype as unknown as {
        prepareBaseline(
          this: BaselineHarness,
          index: ValidatedIndexFixture,
        ): Promise<void>;
      }
    ).prepareBaseline;

    await expect(prepareBaseline.call(harness, validated)).rejects.toBe(
      scanError,
    );
    expect(harness.searchReady).toBe(false);
    expect(harness.baselineIndex).toBe(validated.concreteIndex);
    expect(harness.baselineIndexUuid).toBe(validated.indexUuid);
    expect(harness.baselineScanComplete).toBe(false);
    expect(harness.refreshBaselineReadiness).not.toHaveBeenCalled();

    await expect(
      prepareBaseline.call(harness, validated),
    ).resolves.toBeUndefined();
    expect(harness.reindexAll).toHaveBeenCalledTimes(2);
    expect(harness.baselineScanComplete).toBe(true);
    expect(harness.refreshBaselineReadiness).toHaveBeenCalledTimes(1);
  });
});

describe('JobIndexingService index mapping validation', () => {
  it(
    'accepts an alias resolving to one fully compatible concrete index',
    async () => {
      const concreteIndex = 'jobs-v3-000001';
      const harness = mappingHarness({
        [concreteIndex]: { mappings: fullMapping() },
      });

      await expect(validateMapping(harness)).resolves.toEqual({
        concreteIndex,
        indexUuid: 'index-uuid-000001',
        baselineComplete: false,
      });
      expect(harness.elastic.indices.getMapping).toHaveBeenCalledWith({
        index: 'jobs-read',
      });
      expect(harness.elastic.indices.getSettings).toHaveBeenCalledWith({
        index: concreteIndex,
      });

      const completedMapping = fullMapping();
      completedMapping._meta.baselineVersion = 3;
      completedMapping._meta.baselineIndexUuid = 'index-uuid-000001';
      await expect(validateMapping(mappingHarness({
        [concreteIndex]: { mappings: completedMapping },
      }))).resolves.toMatchObject({ baselineComplete: true });

      completedMapping._meta.baselineIndexUuid = 'replaced-index-uuid';
      await expect(validateMapping(mappingHarness({
        [concreteIndex]: { mappings: completedMapping },
      }))).resolves.toMatchObject({ baselineComplete: false });
    },
  );

  it('rejects an alias resolving to multiple concrete indices', async () => {
    const harness = mappingHarness({
      'jobs-v3-000001': { mappings: fullMapping() },
      'jobs-v3-000002': { mappings: fullMapping() },
    });

    await expectIncompatibleMapping(harness);
    expect(harness.elastic.indices.getSettings).not.toHaveBeenCalled();
  });

  it('rejects a mapping without the title field', async () => {
    const mapping = fullMapping();
    delete mapping.properties.title;
    const harness = mappingHarness({
      'jobs-v3-000001': { mappings: mapping },
    });

    await expectIncompatibleMapping(harness);
  });

  it('rejects an incompatible Vietnamese analyzer', async () => {
    const analysis = fullAnalysis();
    analysis.analyzer.vietnamese_text.tokenizer = 'keyword';
    const harness = mappingHarness({
      'jobs-v3-000001': { mappings: fullMapping() },
    }, analysis);

    await expectIncompatibleMapping(harness);

    const extraCharFilter = fullAnalysis();
    extraCharFilter.analyzer.vietnamese_text.char_filter = ['html_strip'];
    await expectIncompatibleMapping(mappingHarness({
      'jobs-v3-000001': { mappings: fullMapping() },
    }, extraCharFilter));
  });

  it('rejects disabled search fields or a missing keyword subfield', async () => {
    const mapping = fullMapping();
    mapping.properties.skills.fields = {};
    const harness = mappingHarness({
      'jobs-v3-000001': { mappings: mapping },
    });

    await expectIncompatibleMapping(harness);

    const disabledTitle = fullMapping();
    disabledTitle.properties.title.index = false;
    await expectIncompatibleMapping(mappingHarness({
      'jobs-v3-000001': { mappings: disabledTitle },
    }));

    const disabledKeywordDocValues = fullMapping();
    disabledKeywordDocValues.properties.location.fields!
      .keyword.doc_values = false;
    await expectIncompatibleMapping(mappingHarness({
      'jobs-v3-000001': { mappings: disabledKeywordDocValues },
    }));
  });
});

function fullMapping(): MappingFixture {
  return {
    dynamic: 'strict',
    _meta: { projectionVersion: 3 },
    properties: {
      jobId: { type: 'keyword' },
      aggregateVersion: { type: 'long' },
      indexGeneration: { type: 'integer' },
      searchable: { type: 'boolean' },
      companyId: { type: 'keyword' },
      companyName: analyzedText(true),
      title: analyzedText(),
      description: analyzedText(),
      salaryMin: { type: 'double' },
      salaryMax: { type: 'double' },
      isNegotiable: { type: 'boolean' },
      currency: { type: 'keyword' },
      location: analyzedText(true),
      jobType: { type: 'keyword' },
      experienceYears: { type: 'integer' },
      skills: analyzedText(true),
      deadline: { type: 'date' },
      status: { type: 'keyword' },
      publishedAt: { type: 'date' },
    },
  };
}

function analyzedText(keyword = false): MappingFieldFixture {
  return {
    type: 'text',
    analyzer: 'vietnamese_text',
    ...(keyword
      ? { fields: { keyword: { type: 'keyword' } } }
      : {}),
  };
}

function fullAnalysis(): AnalyzerFixture {
  return {
    analyzer: {
      vietnamese_text: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding'],
      },
    },
  };
}

function mappingHarness(
  mappings: Record<string, { mappings: MappingFixture }>,
  analysis = fullAnalysis(),
): MappingValidationHarness {
  return Object.assign(Object.create(JobIndexingService.prototype), {
    index: 'jobs-read',
    elastic: {
      indices: {
        getMapping: jest.fn().mockResolvedValue(mappings),
        getSettings: jest.fn().mockImplementation(
          async ({ index }: { index: string }) => ({
            [index]: {
              settings: {
                index: { uuid: 'index-uuid-000001', analysis },
              },
            },
          }),
        ),
      },
    },
  }) as MappingValidationHarness;
}

function validateMapping(
  harness: MappingValidationHarness,
): Promise<ValidatedIndexFixture> {
  const validateIndexMapping = (
    JobIndexingService.prototype as unknown as {
      validateIndexMapping(
        this: MappingValidationHarness,
      ): Promise<ValidatedIndexFixture>;
    }
  ).validateIndexMapping;
  return validateIndexMapping.call(harness);
}

async function expectIncompatibleMapping(
  harness: MappingValidationHarness,
): Promise<void> {
  await expect(validateMapping(harness)).rejects.toMatchObject({
    name: 'ELASTICSEARCH_INDEX_INCOMPATIBLE',
    message: 'ELASTICSEARCH_INDEX_INCOMPATIBLE',
  });
}
