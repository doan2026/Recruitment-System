'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const CARD_KEYS = [
  'address',
  'id',
  'industry',
  'logoUrl',
  'name',
  'size',
  'slug',
];
const ENVELOPE_KEYS = ['data', 'meta'];
const META_KEYS = ['hasMore', 'limit', 'nextCursor'];
const ERROR_KEYS = ['code', 'details', 'message'];
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

const integerEnv = (name, minimum, maximum) => {
  const value = process.env[name];
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside ${minimum}..${maximum}`);
  }
  return parsed;
};

const decimalEnv = (name, minimum, maximum) => {
  const value = process.env[name];
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${name} must be a decimal number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside ${minimum}..${maximum}`);
  }
  return parsed;
};

const config = {
  dataset: integerEnv('LOAD_DATASET_SIZE', 100_000, 500_000),
  warmupRequests: integerEnv('LOAD_WARMUP_REQUESTS', 0, 100_000),
  measuredRequests: integerEnv('LOAD_MEASURED_REQUESTS', 10_000, 1_000_000),
  concurrency: integerEnv('LOAD_CONCURRENCY', 1, 128),
  requestTimeoutMs: integerEnv('LOAD_REQUEST_TIMEOUT_MS', 100, 10_000),
  maxBodyBytes: integerEnv('LOAD_MAX_BODY_BYTES', 1_024, 1_048_576),
  maxP95Ms: decimalEnv('LOAD_MAX_P95_MS', 1, 60_000),
  maxP99Ms: decimalEnv('LOAD_MAX_P99_MS', 1, 60_000),
  minRequestsPerSecond: decimalEnv('LOAD_MIN_REQUESTS_PER_SECOND', 0.1, 1_000_000),
  seedFingerprint: process.env.LOAD_SEED_FINGERPRINT || '',
  postgresImage: process.env.LOAD_POSTGRES_IMAGE || '',
  applicationImageId: process.env.LOAD_APPLICATION_IMAGE_ID || '',
  unfilteredIndexName: process.env.LOAD_UNFILTERED_INDEX_NAME || '',
  deepIndexName: process.env.LOAD_DEEP_INDEX_NAME || '',
  searchIndexName: process.env.LOAD_SEARCH_INDEX_NAME || '',
};

if (config.dataset % 10 !== 0) {
  throw new Error('LOAD_DATASET_SIZE must be divisible by ten');
}
if (config.maxP95Ms > config.maxP99Ms) {
  throw new Error('the p95 threshold must not exceed the p99 threshold');
}
if (!/^[0-9a-f]{32}$/.test(config.seedFingerprint)) {
  throw new Error('LOAD_SEED_FINGERPRINT must be a lowercase MD5 digest');
}
if (!/^sha256:[0-9a-f]{64}$/.test(config.applicationImageId)) {
  throw new Error('LOAD_APPLICATION_IMAGE_ID must be an exact image ID');
}
for (const [name, value] of [
  ['LOAD_UNFILTERED_INDEX_NAME', config.unfilteredIndexName],
  ['LOAD_DEEP_INDEX_NAME', config.deepIndexName],
  ['LOAD_SEARCH_INDEX_NAME', config.searchIndexName],
]) {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`${name} must be a canonical PostgreSQL index name`);
  }
}

const baseUrl = new URL(process.env.LOAD_BASE_URL || '');
if (
  baseUrl.protocol !== 'http:' ||
  baseUrl.username !== '' ||
  baseUrl.password !== '' ||
  baseUrl.port !== '3000' ||
  baseUrl.pathname !== '/search' ||
  baseUrl.search !== '' ||
  baseUrl.hash !== '' ||
  !/^company-load-api-[0-9a-f-]+$/.test(baseUrl.hostname)
) {
  throw new Error('LOAD_BASE_URL is outside the disposable API allow-list');
}

const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1_000,
  maxSockets: config.concurrency + 4,
  maxFreeSockets: config.concurrency + 4,
});

const patterns = [
  'công ty công nghệ ánh dương',
  'công nghệ đà nẵng',
  'điện máy sài gòn',
  'cơ khí thăng long',
  'nông nghiệp hòa bình',
  'y tế cần thơ',
  'phần mềm việt nam',
  'giáo dục huế',
  'logistics hải phòng',
  'du lịch phú quốc',
];
const industries = [
  'công nghệ',
  'phần mềm',
  'bán lẻ',
  'cơ khí',
  'nông nghiệp',
  'y tế',
  'công nghệ',
  'giáo dục',
  'logistics',
  'du lịch',
];

const pad = (value) => String(value).padStart(6, '0');
const patternFor = (value) => Math.floor((value - 1) / 10) % 10;
const isVerified = (value) => value % 10 >= 1 && value % 10 <= 8;
const uuidFor = (prefix, value) => {
  const hash = createHash('md5').update(`${prefix}${value}`, 'utf8').digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const expectedCompany = (value) => {
  const ordinal = pad(value);
  const pattern = patternFor(value);
  return {
    id: uuidFor('company-load-id-', value),
    name: `company ${ordinal} ${patterns[pattern]}`,
    slug: `load-company-${ordinal}`,
    industry: industries[pattern],
    size: '51-200',
    address: `địa chỉ kiểm thử ${ordinal}, việt nam`,
    logoUrl:
      value % 20 === 1
        ? `https://res.cloudinary.com/recruitment/image/upload/load-logo-${ordinal}.png`
        : null,
  };
};

const idToIndex = new Map();
const expectedVerified = [];
const expectedVietnameseSearch = [];
for (let index = 1; index <= config.dataset; index += 1) {
  const id = uuidFor('company-load-id-', index);
  idToIndex.set(id, index);
  if (isVerified(index)) {
    expectedVerified.push(index);
    if (patternFor(index) === 1) expectedVietnameseSearch.push(index);
  }
}

let correctnessRequestCount = 0;
let maximumObservedBodyBytes = 0;

const exactKeys = (value, expected, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has unexpected keys: ${actual.join(',')}`);
  }
};

const request = (search) =>
  new Promise((resolve, reject) => {
    const target = new URL(search, baseUrl);
    const startedAt = performance.now();
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = http.request(
      target,
      {
        method: 'GET',
        agent,
        headers: {
          accept: 'application/json',
          'user-agent': 'company-public-search-load-gate/1.0',
        },
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > config.maxBodyBytes) {
            req.destroy(
              new Error(`response exceeded ${config.maxBodyBytes} bytes`),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          maximumObservedBodyBytes = Math.max(maximumObservedBodyBytes, bytes);
          resolve({
            status: response.statusCode || 0,
            contentType: String(response.headers['content-type'] || ''),
            cacheControl: String(response.headers['cache-control'] || ''),
            pragma: String(response.headers.pragma || ''),
            body: Buffer.concat(chunks).toString('utf8'),
            bytes,
            durationMs: performance.now() - startedAt,
          });
        });
        response.on('error', finishReject);
      },
    );
    req.setTimeout(config.requestTimeoutMs, () => {
      req.destroy(
        new Error(`request exceeded ${config.requestTimeoutMs} milliseconds`),
      );
    });
    req.on('error', finishReject);
    req.end();
  });

const parseJson = (response, label) => {
  if (!response.contentType.toLowerCase().startsWith('application/json')) {
    throw new Error(`${label} did not return application/json`);
  }
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
};

const validateCacheHeaders = (response, label) => {
  if (response.cacheControl.toLowerCase() !== 'no-store') {
    throw new Error(`${label} did not return Cache-Control: no-store`);
  }
  if (response.pragma.toLowerCase() !== 'no-cache') {
    throw new Error(`${label} did not return Pragma: no-cache`);
  }
};

const validateCard = (card) => {
  exactKeys(card, CARD_KEYS, 'public Company card');
  if (!UUID_V4_PATTERN.test(card.id)) {
    throw new Error('public Company card has a non-canonical UUID v4');
  }
  const fixtureIndex = idToIndex.get(card.id);
  if (!fixtureIndex || !isVerified(fixtureIndex)) {
    throw new Error('a non-VERIFIED or unknown Company leaked into public search');
  }
  const expected = expectedCompany(fixtureIndex);
  for (const key of CARD_KEYS) {
    if (card[key] !== expected[key]) {
      throw new Error(`public Company card field mismatch: ${key}`);
    }
  }
  return fixtureIndex;
};

const validateSuccess = (response, expectedLimit) => {
  if (response.status !== 200) {
    throw new Error(`expected HTTP 200 but received ${response.status}`);
  }
  validateCacheHeaders(response, 'public Company search success');
  const payload = parseJson(response, 'public Company search');
  exactKeys(payload, ENVELOPE_KEYS, 'success envelope');
  if (!Array.isArray(payload.data) || payload.data.length > expectedLimit) {
    throw new Error('success data is not a bounded array');
  }
  exactKeys(payload.meta, META_KEYS, 'success metadata');
  if (
    payload.meta.limit !== expectedLimit ||
    typeof payload.meta.hasMore !== 'boolean'
  ) {
    throw new Error('success metadata limit/hasMore is invalid');
  }
  if (payload.meta.hasMore) {
    if (
      typeof payload.meta.nextCursor !== 'string' ||
      payload.meta.nextCursor.length > 1_024 ||
      !CURSOR_PATTERN.test(payload.meta.nextCursor)
    ) {
      throw new Error('success metadata continuation cursor is invalid');
    }
  } else if (payload.meta.nextCursor !== null) {
    throw new Error('a terminal page returned a continuation cursor');
  }
  const indices = payload.data.map(validateCard);
  return { payload, indices };
};

const getSuccess = async (search, expectedLimit, measured = false) => {
  const response = await request(search);
  if (!measured) correctnessRequestCount += 1;
  return { response, ...validateSuccess(response, expectedLimit) };
};

const expectError = async (search, expectedCode) => {
  const response = await request(search);
  correctnessRequestCount += 1;
  if (response.status >= 500) {
    throw new Error(`negative request returned HTTP ${response.status}`);
  }
  if (response.status !== 400) {
    throw new Error(`negative request expected HTTP 400, got ${response.status}`);
  }
  validateCacheHeaders(response, 'public Company search error');
  const payload = parseJson(response, 'public Company search error');
  exactKeys(payload, ERROR_KEYS, 'error envelope');
  if (payload.code !== expectedCode || typeof payload.message !== 'string') {
    throw new Error(`unexpected error contract: ${String(payload.code)}`);
  }
};

const normalizeQuery = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const decodeCursor = (cursor) => {
  const [body] = cursor.split('.');
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('API returned an undecodable cursor payload');
  }
};

const makeSearch = (query, limit, cursor) => {
  const parameters = new URLSearchParams();
  if (query !== null) parameters.set('q', query);
  parameters.set('limit', String(limit));
  if (cursor) parameters.set('cursor', cursor);
  return `?${parameters.toString()}`;
};

const collectAll = async ({
  label,
  query,
  expectedIndices,
  collectContinuationPaths,
}) => {
  const limit = 50;
  let cursor = null;
  let pages = 0;
  let previousIndex = 0;
  let expectedOffset = 0;
  const ids = [];
  const continuationPaths = [];
  do {
    const { payload, indices } = await getSuccess(
      makeSearch(query, limit, cursor),
      limit,
    );
    pages += 1;
    for (const fixtureIndex of indices) {
      if (fixtureIndex <= previousIndex) {
        throw new Error(`${label} is not in deterministic keyset order`);
      }
      if (fixtureIndex !== expectedIndices[expectedOffset]) {
        throw new Error(`${label} omitted or inserted a Company`);
      }
      previousIndex = fixtureIndex;
      expectedOffset += 1;
      ids.push(uuidFor('company-load-id-', fixtureIndex));
    }
    if (payload.meta.hasMore) {
      if (indices.length !== limit) {
        throw new Error(`${label} returned hasMore for a short page`);
      }
      const lastIndex = indices.at(-1);
      const last = expectedCompany(lastIndex);
      const decoded = decodeCursor(payload.meta.nextCursor);
      if (
        decoded.v !== 1 ||
        decoded.q !== (query === null ? null : normalizeQuery(query)) ||
        decoded.l !== limit ||
        decoded.n !== last.name ||
        decoded.i !== last.id
      ) {
        throw new Error(`${label} cursor does not bind the last row/scope`);
      }
      cursor = payload.meta.nextCursor;
      if (
        collectContinuationPaths &&
        continuationPaths.length < 128 &&
        (pages === 1 || pages % 10 === 0)
      ) {
        continuationPaths.push(makeSearch(query, limit, cursor));
      }
    } else {
      cursor = null;
    }
  } while (cursor !== null);

  if (expectedOffset !== expectedIndices.length) {
    throw new Error(`${label} terminal count is incorrect`);
  }
  return { ids, pages, continuationPaths };
};

const percentile = (sorted, ratio) => {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
};

const benchmark = async (unfilteredContinuations, searchContinuations) => {
  if (unfilteredContinuations.length === 0 || searchContinuations.length === 0) {
    throw new Error('continuation cursor pool is empty');
  }
  const accentedQuery = 'Công nghệ Đà Nẵng';
  const noMatchQuery = 'không tồn tại 999999';
  const pathAt = (index) => {
    const slot = index % 20;
    if (slot < 7) return makeSearch(null, 20, null);
    if (slot < 12) {
      return unfilteredContinuations[index % unfilteredContinuations.length];
    }
    if (slot < 16) return makeSearch(accentedQuery, 20, null);
    if (slot < 18) {
      return searchContinuations[index % searchContinuations.length];
    }
    return makeSearch(noMatchQuery, 20, null);
  };
  const expectedLimit = (search) => {
    const value = new URL(search, baseUrl).searchParams.get('limit');
    return Number(value);
  };
  const run = async (count, record) => {
    let next = 0;
    let errors = 0;
    let localMaximumBodyBytes = 0;
    const latencies = [];
    const samples = [];
    const startedAt = performance.now();
    const workers = Array.from(
      { length: Math.min(config.concurrency, Math.max(count, 1)) },
      async () => {
        while (true) {
          const requestIndex = next;
          next += 1;
          if (requestIndex >= count) return;
          const path = pathAt(requestIndex);
          try {
            const result = await getSuccess(
              path,
              expectedLimit(path),
              true,
            );
            if (record) {
              latencies.push(result.response.durationMs);
              localMaximumBodyBytes = Math.max(
                localMaximumBodyBytes,
                result.response.bytes,
              );
            }
          } catch (error) {
            errors += 1;
            if (samples.length < 5) {
              samples.push(
                error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
              );
            }
          }
        }
      },
    );
    await Promise.all(workers);
    const durationMs = performance.now() - startedAt;
    return {
      count,
      errors,
      samples,
      durationMs,
      latencies,
      maximumBodyBytes: localMaximumBodyBytes,
    };
  };

  const warmup = await run(config.warmupRequests, false);
  if (warmup.errors !== 0) {
    throw new Error(`warmup failed: ${warmup.samples.join('; ')}`);
  }
  const measured = await run(config.measuredRequests, true);
  const sorted = measured.latencies.sort((left, right) => left - right);
  const result = {
    requests: config.measuredRequests,
    concurrency: config.concurrency,
    durationMs: Number(measured.durationMs.toFixed(3)),
    errors: measured.errors,
    requestsPerSecond: Number(
      (config.measuredRequests / (measured.durationMs / 1_000)).toFixed(3),
    ),
    p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
    p99Ms: Number(percentile(sorted, 0.99).toFixed(3)),
    maxMs: Number((sorted.at(-1) || 0).toFixed(3)),
    maxBodyBytes: measured.maximumBodyBytes,
    errorSamples: measured.samples,
  };
  if (
    result.errors !== 0 ||
    sorted.length !== config.measuredRequests ||
    result.p95Ms > config.maxP95Ms ||
    result.p99Ms > config.maxP99Ms ||
    result.requestsPerSecond < config.minRequestsPerSecond ||
    result.maxBodyBytes > config.maxBodyBytes
  ) {
    throw new Error(`benchmark thresholds failed: ${JSON.stringify(result)}`);
  }
  return result;
};

const run = async () => {
  const unfiltered = await collectAll({
    label: 'unfiltered traversal',
    query: null,
    expectedIndices: expectedVerified,
    collectContinuationPaths: true,
  });

  const accentedQuery = 'Công nghệ Đà Nẵng';
  const decomposedQuery = accentedQuery.normalize('NFD');
  const unaccentedQuery = 'cong nghe da nang';
  const accented = await collectAll({
    label: 'accented Vietnamese traversal',
    query: accentedQuery,
    expectedIndices: expectedVietnameseSearch,
    collectContinuationPaths: true,
  });
  const decomposed = await collectAll({
    label: 'decomposed Vietnamese traversal',
    query: decomposedQuery,
    expectedIndices: expectedVietnameseSearch,
    collectContinuationPaths: false,
  });
  const unaccented = await collectAll({
    label: 'unaccented Vietnamese traversal',
    query: unaccentedQuery,
    expectedIndices: expectedVietnameseSearch,
    collectContinuationPaths: false,
  });
  if (
    accented.ids.join('\n') !== decomposed.ids.join('\n') ||
    accented.ids.join('\n') !== unaccented.ids.join('\n')
  ) {
    throw new Error('Vietnamese accent forms returned different Company IDs');
  }

  const pending = await getSuccess(makeSearch('company 000009', 20), 20);
  const rejected = await getSuccess(makeSearch('company 000010', 20), 20);
  const noMatch = await getSuccess(
    makeSearch('không tồn tại 999999', 20),
    20,
  );
  if (
    pending.payload.data.length !== 0 ||
    rejected.payload.data.length !== 0 ||
    noMatch.payload.data.length !== 0
  ) {
    throw new Error('private status/no-match search returned a Company');
  }

  const scoped = await getSuccess(makeSearch(null, 2), 2);
  const cursor = scoped.payload.meta.nextCursor;
  if (!cursor) throw new Error('cursor negative tests require a continuation');
  const [body, signature] = cursor.split('.');
  const tamperedSignature =
    (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  await expectError(
    makeSearch(null, 2, `${body}.${tamperedSignature}`),
    'COMPANY_SEARCH_CURSOR_INVALID',
  );
  await expectError(
    makeSearch('công nghệ', 2, cursor),
    'COMPANY_SEARCH_CURSOR_SCOPE_MISMATCH',
  );
  await expectError(
    makeSearch(null, 3, cursor),
    'COMPANY_SEARCH_CURSOR_SCOPE_MISMATCH',
  );
  await expectError('?limit=20&verified_status=PENDING', 'VALIDATION_ERROR');

  const benchmarkResult = await benchmark(
    unfiltered.continuationPaths,
    accented.continuationPaths,
  );
  const report = {
    gate: 'company-public-search-load-v1',
    dataset: {
      total: config.dataset,
      verified: expectedVerified.length,
      pending: config.dataset / 10,
      rejected: config.dataset / 10,
      fingerprint: config.seedFingerprint,
    },
    runtime: {
      postgresImage: config.postgresImage,
      applicationImageId: config.applicationImageId,
      requestTimeoutMs: config.requestTimeoutMs,
      maxBodyBytes: config.maxBodyBytes,
    },
    postgresPlans: {
      unfilteredIndex: config.unfilteredIndexName,
      deepContinuationIndex: config.deepIndexName,
      vietnameseSearchIndex: config.searchIndexName,
      sequentialScan: false,
    },
    correctness: {
      httpRequests: correctnessRequestCount,
      unfilteredPages: unfiltered.pages,
      unfilteredRows: unfiltered.ids.length,
      vietnamesePagesPerForm: accented.pages,
      vietnameseRowsPerForm: accented.ids.length,
      cursorScopeAndTamper: 'PASS',
      statusIsolationAndCardPrivacy: 'PASS',
      deterministicOrderAndNoDuplicates: 'PASS',
      maximumObservedBodyBytes,
    },
    thresholds: {
      maxP95Ms: config.maxP95Ms,
      maxP99Ms: config.maxP99Ms,
      minRequestsPerSecond: config.minRequestsPerSecond,
      maxBodyBytes: config.maxBodyBytes,
      errors: 0,
    },
    benchmark: benchmarkResult,
    status: 'PASS',
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stdout.write(
    `[company-public-search] PASS ${config.dataset} rows; ` +
      `${benchmarkResult.requests} requests; p95=${benchmarkResult.p95Ms}ms; ` +
      `p99=${benchmarkResult.p99Ms}ms; rps=${benchmarkResult.requestsPerSecond}\n`,
  );
};

run()
  .catch((error) => {
    process.stderr.write(
      `[company-public-search] ERROR: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => agent.destroy());
