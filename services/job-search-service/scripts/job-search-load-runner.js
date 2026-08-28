'use strict';

const { createHash } = require('node:crypto');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const { Client } = require('@elastic/elasticsearch');

const SPECIAL_TEXT = 'Kỹ sư dữ liệu Đà Nẵng';
const PRIVATE_MARKER = 'PRIVATE-INTERNAL-MARKER';
const HIDDEN_STATUS_MARKER = 'HIDDEN-STATUS-ONLY-MARKER';
const PUBLIC_SLOTS = new Set(Array.from({ length: 16 }, (_, index) => index + 1));
const LOCATIONS = ['Hà Nội', 'Đà Nẵng', 'Hồ Chí Minh', 'Cần Thơ'];
const JOB_TYPES = ['FULL_TIME', 'PART_TIME', 'REMOTE', 'INTERNSHIP'];
const BASE_SKILLS = ['NestJS', 'PostgreSQL', 'Redis', 'Elasticsearch'];
const ITEM_KEYS = [
  'companyId',
  'companyName',
  'currency',
  'deadline',
  'description',
  'experienceYears',
  'id',
  'isNegotiable',
  'jobType',
  'location',
  'publishedAt',
  'salaryMax',
  'salaryMin',
  'score',
  'skills',
  'title',
];
const RESULT_KEYS = [
  'facets',
  'hasMore',
  'items',
  'limit',
  'nextCursor',
  'page',
  'source',
  'total',
];
const FACET_KEYS = ['companies', 'jobTypes', 'locations', 'skills'];

const fail = (message) => {
  throw new Error(message);
};

const integer = (name, fallback, minimum, maximum) => {
  const raw = process.env[name] ?? String(fallback);
  if (!/^[0-9]+$/.test(raw)) fail(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be in ${minimum}..${maximum}`);
  }
  return value;
};

const config = {
  phase: process.env.LOAD_PHASE ?? 'verify',
  dataset: integer('LOAD_DATASET_SIZE', 100000, 100000, 100000),
  warmupRequests: integer('LOAD_WARMUP_REQUESTS', 500, 500, 500),
  measuredRequests: integer('LOAD_MEASURED_REQUESTS', 10000, 10000, 10000),
  concurrency: integer('LOAD_CONCURRENCY', 32, 32, 32),
  requestTimeoutMs: integer('LOAD_REQUEST_TIMEOUT_MS', 3000, 100, 10000),
  maxBodyBytes: integer('LOAD_MAX_BODY_BYTES', 262144, 4096, 1048576),
  maxP95Ms: integer('LOAD_MAX_P95_MS', 500, 1, 500),
  maxP99Ms: integer('LOAD_MAX_P99_MS', 1000, 1, 1000),
  minRequestsPerSecond: integer(
    'LOAD_MIN_REQUESTS_PER_SECOND',
    75,
    75,
    1000000,
  ),
  elasticsearchNode: process.env.LOAD_ELASTICSEARCH_NODE,
  elasticsearchIndex: process.env.LOAD_ELASTICSEARCH_INDEX ?? 'job_index_v4',
  baseUrl: process.env.LOAD_BASE_URL,
  postgresFingerprint: process.env.LOAD_POSTGRES_FINGERPRINT ?? '',
  applicationImageId: process.env.LOAD_APPLICATION_IMAGE_ID ?? '',
  postgresImageId: process.env.LOAD_POSTGRES_IMAGE_ID ?? '',
  postgresImageRef: process.env.LOAD_POSTGRES_IMAGE_REF ?? '',
  redisImageId: process.env.LOAD_REDIS_IMAGE_ID ?? '',
  redisImageRef: process.env.LOAD_REDIS_IMAGE_REF ?? '',
  elasticsearchImageId: process.env.LOAD_ELASTICSEARCH_IMAGE_ID ?? '',
  elasticsearchImageRef: process.env.LOAD_ELASTICSEARCH_IMAGE_REF ?? '',
  nodeImage: process.env.LOAD_NODE_IMAGE ?? '',
};

if (config.dataset % 20 !== 0) {
  fail('LOAD_DATASET_SIZE must be divisible by 20');
}
if (config.maxP95Ms > config.maxP99Ms) {
  fail('p95 threshold must not exceed p99');
}
if (!['seed', 'verify'].includes(config.phase)) {
  fail('LOAD_PHASE must be seed or verify');
}
if (
  !config.elasticsearchNode ||
  !/^http:\/\/[a-z0-9][a-z0-9.-]*:[0-9]{1,5}$/.test(config.elasticsearchNode)
) {
  fail('LOAD_ELASTICSEARCH_NODE must be an internal HTTP URL');
}
if (!/^[a-z0-9][a-z0-9._-]{0,254}$/.test(config.elasticsearchIndex)) {
  fail('LOAD_ELASTICSEARCH_INDEX is invalid');
}
if (
  config.phase === 'verify' &&
  (!config.baseUrl ||
    !/^http:\/\/[a-z0-9][a-z0-9.-]*:[0-9]{1,5}\/search$/.test(config.baseUrl))
) {
  fail('LOAD_BASE_URL must be the internal Job Search /search endpoint');
}

const pad = (value, length = 12) => String(value).padStart(length, '0');
const jobId = (sequence) => `10000000-0000-4000-8000-${pad(sequence)}`;
const companyId = (sequence) =>
  `20000000-0000-4000-8000-${pad(((sequence - 1) % 20) + 1)}`;
const slot = (sequence) => sequence % 20;
const isPublic = (sequence) => PUBLIC_SLOTS.has(slot(sequence));
const locationFor = (sequence) => LOCATIONS[sequence % 4];
const jobTypeFor = (sequence) => JOB_TYPES[sequence % 4];
const baseSkillFor = (sequence) => BASE_SKILLS[sequence % 4];
const publishedAtFor = (sequence) =>
  new Date(Date.UTC(2025, 0, 1) + Math.floor((sequence - 1) / 5) * 1000)
    .toISOString();
const statusFor = (sequence) => {
  const value = slot(sequence);
  if (value >= 1 && value <= 16) return 'PUBLISHED';
  if (value === 17) return 'DRAFT';
  if (value === 18) return 'PENDING_APPROVAL';
  if (value === 19) return 'CLOSED';
  return 'EXPIRED';
};

const fixture = (sequence) => {
  const specialSlot = slot(sequence);
  const negotiable = sequence % 13 === 0;
  const salaryMin = negotiable ? null : 12000000 + (sequence % 100) * 100000;
  const salaryMax = negotiable ? null : 17000000 + (sequence % 100) * 100000;
  return {
    sequence,
    id: jobId(sequence),
    companyId: companyId(sequence),
    title: specialSlot === 1
      ? SPECIAL_TEXT
      : isPublic(sequence)
        ? `Backend platform role ${pad(sequence, 6)}`
        : `${HIDDEN_STATUS_MARKER} ${pad(sequence, 6)}`,
    description: specialSlot === 2
      ? SPECIAL_TEXT
      : 'Scalable recruitment platform services',
    salaryMin,
    salaryMax,
    isNegotiable: negotiable,
    currency: 'VND',
    location: locationFor(sequence),
    jobType: jobTypeFor(sequence),
    experienceYears: sequence % 8,
    skills: specialSlot === 3
      ? [baseSkillFor(sequence), SPECIAL_TEXT]
      : [baseSkillFor(sequence)],
    deadline: specialSlot === 0 ? '2025-01-01' : '2099-12-31',
    status: statusFor(sequence),
    publishedAt: isPublic(sequence) ? publishedAtFor(sequence) : null,
    companyName: specialSlot === 4
      ? SPECIAL_TEXT
      : `Công ty Tuyển dụng ${pad(((sequence - 1) % 20) + 1, 2)}`,
  };
};

const documentFor = (sequence) => {
  const value = fixture(sequence);
  if (!isPublic(sequence)) {
    return {
      jobId: value.id,
      aggregateVersion: 1,
      indexGeneration: 1,
      searchable: false,
      status: value.status,
    };
  }
  return {
    jobId: value.id,
    aggregateVersion: 1,
    indexGeneration: 1,
    searchable: true,
    companyId: value.companyId,
    companyName: value.companyName,
    title: value.title,
    description: value.description,
    salaryMin: value.salaryMin,
    salaryMax: value.salaryMax,
    isNegotiable: value.isNegotiable,
    currency: value.currency,
    location: value.location,
    jobType: value.jobType,
    experienceYears: value.experienceYears,
    skills: value.skills,
    deadline: value.deadline,
    status: value.status,
    publishedAt: value.publishedAt,
  };
};

const sequenceFromId = (id) => {
  if (!/^10000000-0000-4000-8000-[0-9]{12}$/.test(id)) {
    fail(`unexpected Job id ${String(id).slice(0, 80)}`);
  }
  const value = Number(id.slice(-12));
  if (!Number.isSafeInteger(value) || value < 1 || value > config.dataset) {
    fail(`Job id is outside the fixture: ${id}`);
  }
  return value;
};

const fixtureFingerprint = () => {
  const digest = createHash('md5');
  for (let sequence = 1; sequence <= config.dataset; sequence += 1) {
    const value = fixture(sequence);
    if (sequence > 1) digest.update('\n');
    digest.update(
      `${value.id}|${value.status}|${value.title}|${value.location}|` +
      `${value.salaryMax ?? '<null>'}|${value.publishedAt ?? '<null>'}`,
    );
  }
  return digest.digest('hex');
};

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (actual.join('|') !== [...expected].sort().join('|')) {
    fail(`${label} keys differ: ${actual.join(',')}`);
  }
};

const sameRecord = (actual, expected, label) => {
  exactKeys(actual, Object.keys(expected), label);
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      fail(`${label}.${key} expected ${String(value)}, got ${String(actual[key])}`);
    }
  }
};

const mappingContract = async (elastic) => {
  const mappings = await elastic.indices.getMapping({
    index: config.elasticsearchIndex,
  });
  const entries = Object.entries(mappings);
  if (entries.length !== 1) fail('search index must resolve to one concrete index');
  const [concreteIndex, configured] = entries[0];
  const mapping = configured.mappings;
  const properties = mapping.properties ?? {};
  if (mapping.dynamic !== 'strict') fail('Elasticsearch mapping is not strict');
  if (
    mapping._meta?.projectionVersion !== 4 ||
    mapping._meta?.baselineVersion !== 4 ||
    typeof mapping._meta?.baselineIndexUuid !== 'string'
  ) {
    fail('Elasticsearch v4 baseline metadata is incomplete');
  }
  const expectedFields = {
    jobId: 'keyword',
    aggregateVersion: 'long',
    indexGeneration: 'integer',
    searchable: 'boolean',
    companyId: 'keyword',
    companyName: 'text',
    title: 'text',
    description: 'text',
    salaryMin: 'double',
    salaryMax: 'double',
    isNegotiable: 'boolean',
    currency: 'keyword',
    location: 'text',
    jobType: 'keyword',
    experienceYears: 'integer',
    skills: 'text',
    deadline: 'date',
    status: 'keyword',
    publishedAt: 'date',
  };
  exactKeys(properties, Object.keys(expectedFields), 'mapping.properties');
  for (const [name, type] of Object.entries(expectedFields)) {
    if (properties[name]?.type !== type) fail(`mapping ${name} is not ${type}`);
  }
  for (const name of ['companyName', 'title', 'description', 'location', 'skills']) {
    if (properties[name]?.analyzer !== 'vietnamese_text') {
      fail(`mapping ${name} does not use vietnamese_text`);
    }
  }
  for (const name of ['companyName', 'location', 'skills']) {
    if (properties[name]?.fields?.keyword?.type !== 'keyword') {
      fail(`mapping ${name}.keyword is missing`);
    }
  }

  const settings = await elastic.indices.getSettings({ index: concreteIndex });
  const indexSettings = settings[concreteIndex]?.settings?.index;
  if (indexSettings?.uuid !== mapping._meta.baselineIndexUuid) {
    fail('baselineIndexUuid does not match the physical index UUID');
  }
  const analysis = indexSettings?.analysis;
  exactKeys(analysis, ['analyzer', 'char_filter'], 'settings.analysis');
  exactKeys(analysis.analyzer, ['vietnamese_text'], 'settings.analysis.analyzer');
  const analyzer = analysis.analyzer.vietnamese_text;
  exactKeys(
    analyzer,
    ['type', 'tokenizer', 'char_filter', 'filter'],
    'settings.analysis.analyzer.vietnamese_text',
  );
  if (
    analyzer?.type !== 'custom' ||
    analyzer?.tokenizer !== 'standard' ||
    JSON.stringify(analyzer?.char_filter) !==
      JSON.stringify(['vietnamese_combining_marks']) ||
    JSON.stringify(analyzer?.filter) !== JSON.stringify(['lowercase', 'asciifolding'])
  ) {
    fail('vietnamese_text analyzer contract differs');
  }
  exactKeys(
    analysis.char_filter,
    ['vietnamese_combining_marks'],
    'settings.analysis.char_filter',
  );
  const combiningMarks = analysis.char_filter.vietnamese_combining_marks;
  exactKeys(
    combiningMarks,
    ['type', 'pattern', 'replacement'],
    'settings.analysis.char_filter.vietnamese_combining_marks',
  );
  if (
    combiningMarks.type !== 'pattern_replace' ||
    combiningMarks.pattern !== '\\p{M}' ||
    combiningMarks.replacement !== ''
  ) {
    fail('vietnamese_combining_marks character filter contract differs');
  }

  const analyze = async (text) => {
    const response = await elastic.indices.analyze({
      index: concreteIndex,
      analyzer: 'vietnamese_text',
      text,
    });
    return (response.tokens ?? []).map((token) => token.token);
  };
  const nfc = await analyze(SPECIAL_TEXT);
  const nfd = await analyze(SPECIAL_TEXT.normalize('NFD'));
  const accentless = await analyze('ky su du lieu da nang');
  const expectedTokens = ['ky', 'su', 'du', 'lieu', 'da', 'nang'];
  if (
    nfc.join('|') !== expectedTokens.join('|') ||
    nfd.join('|') !== expectedTokens.join('|') ||
    accentless.join('|') !== expectedTokens.join('|')
  ) {
    fail(`Vietnamese analyzer tokens differ: ${JSON.stringify({ nfc, nfd, accentless })}`);
  }
  return { concreteIndex, analyzerTokens: nfc };
};

const seedElasticsearch = async () => {
  const elastic = new Client({
    node: config.elasticsearchNode,
    requestTimeout: 30000,
    maxRetries: 0,
  });
  try {
    const mapping = await mappingContract(elastic);
    const before = await elastic.count({ index: config.elasticsearchIndex });
    if (before.count !== 0) fail('Elasticsearch fixture target is not empty');
    await elastic.indices.putSettings({
      index: config.elasticsearchIndex,
      settings: { refresh_interval: '-1', number_of_replicas: 0 },
    });
    const batchSize = 1000;
    for (let start = 1; start <= config.dataset; start += batchSize) {
      const operations = [];
      const end = Math.min(config.dataset, start + batchSize - 1);
      for (let sequence = start; sequence <= end; sequence += 1) {
        operations.push({
          index: { _index: config.elasticsearchIndex, _id: jobId(sequence) },
        });
        operations.push(documentFor(sequence));
      }
      const response = await elastic.bulk({
        operations,
        refresh: false,
        timeout: '60s',
      });
      if (response.errors) {
        const first = response.items.find((item) => item.index?.error);
        fail(`Elasticsearch bulk seed failed: ${JSON.stringify(first).slice(0, 500)}`);
      }
    }
    await elastic.indices.putSettings({
      index: config.elasticsearchIndex,
      settings: { refresh_interval: '1s' },
    });
    await elastic.indices.refresh({ index: config.elasticsearchIndex });

    const counts = {};
    const queries = {
      total: { match_all: {} },
      public: { term: { searchable: true } },
      draft: { term: { status: 'DRAFT' } },
      pending: { term: { status: 'PENDING_APPROVAL' } },
      closed: { term: { status: 'CLOSED' } },
      expired: { term: { status: 'EXPIRED' } },
    };
    for (const [name, query] of Object.entries(queries)) {
      counts[name] = (await elastic.count({
        index: config.elasticsearchIndex,
        query,
      })).count;
    }
    const hiddenPerStatus = config.dataset / 20;
    const expected = {
      total: config.dataset,
      public: config.dataset * 4 / 5,
      draft: hiddenPerStatus,
      pending: hiddenPerStatus,
      closed: hiddenPerStatus,
      expired: hiddenPerStatus,
    };
    sameRecord(counts, expected, 'Elasticsearch seed counts');
    process.stdout.write(`${JSON.stringify({
      gate: 'job-search-load-v1',
      phase: 'seed',
      dataset: expected,
      fixtureFingerprint: fixtureFingerprint(),
      mapping,
      status: 'PASS',
    })}\n`);
    process.stdout.write('[job-search-load] SEED PASS\n');
  } finally {
    await elastic.close();
  }
};
