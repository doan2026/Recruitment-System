
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: config.concurrency,
  maxFreeSockets: config.concurrency,
  timeout: config.requestTimeoutMs,
});

const requestJson = (path) => new Promise((resolve, reject) => {
  const url = new URL(path, config.baseUrl);
  const startedAt = performance.now();
  const request = http.request(url, {
    method: 'GET',
    agent,
    headers: { accept: 'application/json', connection: 'keep-alive' },
  }, (response) => {
    const chunks = [];
    let bytes = 0;
    response.on('error', reject);
    response.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > config.maxBodyBytes) {
        response.destroy(new Error(`response exceeded ${config.maxBodyBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => {
      const durationMs = performance.now() - startedAt;
      const text = Buffer.concat(chunks).toString('utf8');
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        reject(new Error(`HTTP ${response.statusCode} returned invalid JSON`));
        return;
      }
      resolve({
        status: response.statusCode ?? 0,
        body,
        bytes,
        durationMs,
      });
    });
  });
  request.setTimeout(config.requestTimeoutMs, () => {
    request.destroy(new Error(`request exceeded ${config.requestTimeoutMs}ms`));
  });
  request.on('error', reject);
  request.end();
});

const searchPath = (query = {}) => {
  const url = new URL(config.baseUrl);
  for (const [name, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) url.searchParams.append(name, String(value));
  }
  return `${url.pathname}${url.search}`;
};

const assertItem = (item) => {
  exactKeys(item, ITEM_KEYS, 'search item');
  const sequence = sequenceFromId(item.id);
  if (!isPublic(sequence)) fail(`hidden fixture Job leaked: ${item.id}`);
  const expected = fixture(sequence);
  const fields = {
    id: expected.id,
    companyId: expected.companyId,
    title: expected.title,
    description: expected.description,
    salaryMin: expected.salaryMin === null ? null : String(expected.salaryMin),
    salaryMax: expected.salaryMax === null ? null : String(expected.salaryMax),
    isNegotiable: expected.isNegotiable,
    currency: expected.currency,
    location: expected.location,
    jobType: expected.jobType,
    experienceYears: expected.experienceYears,
    skills: expected.skills,
    deadline: expected.deadline,
    publishedAt: expected.publishedAt,
    companyName: expected.companyName,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (!Array.isArray(item[name]) || item[name].join('|') !== value.join('|')) {
        fail(`search item ${item.id} has incorrect ${name}`);
      }
    } else if (item[name] !== value) {
      fail(
        `search item ${item.id}.${name} expected ${String(value)}, ` +
        `got ${String(item[name])}`,
      );
    }
  }
  if (item.score !== null && typeof item.score !== 'number') {
    fail(`search item ${item.id} has invalid score`);
  }
  if (JSON.stringify(item).includes(PRIVATE_MARKER)) {
    fail(`private Job content leaked for ${item.id}`);
  }
  return sequence;
};

const assertSearchResponse = (response, expected = {}) => {
  if (response.status !== 200) {
    fail(`HTTP search returned ${response.status}: ${JSON.stringify(response.body).slice(0, 300)}`);
  }
  exactKeys(response.body, ['data', 'meta'], 'response envelope');
  if (response.body.meta !== null) fail('response envelope meta must be null');
  const result = response.body.data;
  exactKeys(result, RESULT_KEYS, 'search result');
  exactKeys(result.facets, FACET_KEYS, 'search facets');
  for (const name of FACET_KEYS) {
    if (
      !result.facets[name] ||
      typeof result.facets[name] !== 'object' ||
      Array.isArray(result.facets[name])
    ) {
      fail(`facet ${name} must be an object`);
    }
    for (const value of Object.values(result.facets[name])) {
      if (!Number.isSafeInteger(value) || value < 1) {
        fail(`facet ${name} has an invalid count`);
      }
    }
  }
  if (result.source !== 'ELASTICSEARCH') {
    fail(`SOURCE_MISMATCH: expected ELASTICSEARCH, got ${String(result.source)}`);
  }
  if (!Number.isSafeInteger(result.total) || result.total < 0) {
    fail('search result total is invalid');
  }
  if (!Number.isSafeInteger(result.page) || result.page < 1) {
    fail('search result page is invalid');
  }
  if (!Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > 50) {
    fail('search result limit is invalid');
  }
  if (!Array.isArray(result.items) || result.items.length > result.limit) {
    fail('search items exceed the response limit');
  }
  if (typeof result.hasMore !== 'boolean') fail('hasMore must be boolean');
  if (expected.cursorMode === true) {
    if (result.hasMore !== (result.nextCursor !== null)) {
      fail('CURSOR hasMore and nextCursor disagree');
    }
  } else if (result.nextCursor !== null) {
    fail('OFFSET response must not return a cursor');
  }
  if (
    result.nextCursor !== null &&
    (typeof result.nextCursor !== 'string' ||
      Buffer.byteLength(result.nextCursor, 'utf8') < 1 ||
      Buffer.byteLength(result.nextCursor, 'utf8') > 4096)
  ) {
    fail('nextCursor is invalid');
  }
  if (expected.cursorMode === true && result.hasMore &&
    result.items.length !== result.limit) {
    fail('hasMore is true for a short page');
  }
  if (expected.total !== undefined && result.total !== expected.total) {
    fail(`search total expected ${expected.total}, got ${result.total}`);
  }
  if (expected.limit !== undefined && result.limit !== expected.limit) {
    fail(`search limit expected ${expected.limit}, got ${result.limit}`);
  }
  if (expected.page !== undefined && result.page !== expected.page) {
    fail(`search page expected ${expected.page}, got ${result.page}`);
  }
  return { result, sequences: result.items.map(assertItem) };
};

const getSearch = async (query, expected = {}) => {
  const response = await requestJson(searchPath(query));
  return {
    ...assertSearchResponse(response, {
      ...expected,
      cursorMode: query.pagination === 'CURSOR',
    }),
    response,
  };
};

const compareNewest = (left, right) => {
  const published = right.publishedAt.localeCompare(left.publishedAt);
  return published || left.id.localeCompare(right.id);
};

const compareSalary = (left, right) => {
  if (left.salaryMax === null && right.salaryMax !== null) return 1;
  if (left.salaryMax !== null && right.salaryMax === null) return -1;
  if (left.salaryMax !== null && right.salaryMax !== null) {
    const salary = right.salaryMax - left.salaryMax;
    if (salary) return salary;
  }
  return compareNewest(left, right);
};

const compareRelevance = (left, right) => {
  if (typeof left.score !== 'number' || typeof right.score !== 'number') {
    fail('relevance sort returned a null score');
  }
  const score = right.score - left.score;
  return score || compareNewest(left, right);
};

const assertPairOrder = (leftItem, rightItem, sort) => {
  const left = { ...fixture(sequenceFromId(leftItem.id)), score: leftItem.score };
  const right = { ...fixture(sequenceFromId(rightItem.id)), score: rightItem.score };
  const compared = sort === 'SALARY_DESC'
    ? compareSalary(left, right)
    : sort === 'RELEVANCE'
      ? compareRelevance(left, right)
      : compareNewest(left, right);
  if (compared > 0) {
    fail(`${sort} order regressed between ${left.id} and ${right.id}`);
  }
};

const expectedPublicFacets = () => {
  const locations = Object.fromEntries(LOCATIONS.map((name) => [name, config.dataset / 5]));
  const jobTypes = Object.fromEntries(JOB_TYPES.map((name) => [name, config.dataset / 5]));
  const skills = Object.fromEntries(BASE_SKILLS.map((name) => [name, config.dataset / 5]));
  skills[SPECIAL_TEXT] = config.dataset / 20;
  const companies = {};
  for (let index = 1; index <= 16; index += 1) {
    companies[`20000000-0000-4000-8000-${pad(index)}`] = config.dataset / 20;
  }
  return { locations, skills, jobTypes, companies };
};

const expectedVietnameseFacets = () => ({
  locations: Object.fromEntries(LOCATIONS.map((name) => [name, config.dataset / 20])),
  skills: {
    NestJS: config.dataset / 20,
    PostgreSQL: config.dataset / 20,
    Redis: config.dataset / 20,
    Elasticsearch: config.dataset / 20,
    [SPECIAL_TEXT]: config.dataset / 20,
  },
  jobTypes: Object.fromEntries(JOB_TYPES.map((name) => [name, config.dataset / 20])),
  companies: Object.fromEntries(
    Array.from({ length: 4 }, (_, offset) => [
      `20000000-0000-4000-8000-${pad(offset + 1)}`,
      config.dataset / 20,
    ]),
  ),
});

const assertFacets = (actual, expected, label) => {
  exactKeys(actual, FACET_KEYS, `${label} facets`);
  for (const name of FACET_KEYS) sameRecord(actual[name], expected[name], `${label}.${name}`);
};

const collectAll = async ({
  label,
  query,
  total,
  sort,
  expectedSequence,
  limit = 50,
}) => {
  const ids = [];
  const seen = new Set();
  const cohortCounts = { title: 0, description: 0, skills: 0, companyName: 0 };
  let cursor;
  let pages = 0;
  let previousItem;
  let firstFacets;
  do {
    pages += 1;
    let pageResponse;
    try {
      pageResponse = await getSearch(
        {
          ...query,
          pagination: 'CURSOR',
          limit,
          ...(cursor ? { cursor } : {}),
        },
        { total, limit, page: pages, cursorMode: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} page ${pages} failed: ${message}`);
    }
    const { result, sequences } = pageResponse;
    if (!firstFacets) firstFacets = result.facets;
    for (let index = 0; index < result.items.length; index += 1) {
      const item = result.items[index];
      const sequence = sequences[index];
      if (expectedSequence && !expectedSequence(sequence)) {
        fail(`${label} returned an out-of-scope Job ${item.id}`);
      }
      if (seen.has(item.id)) fail(`${label} returned duplicate Job ${item.id}`);
      if (previousItem) assertPairOrder(previousItem, item, sort);
      seen.add(item.id);
      ids.push(item.id);
      previousItem = item;
      const specialSlot = slot(sequence);
      if (specialSlot === 1) cohortCounts.title += 1;
      if (specialSlot === 2) cohortCounts.description += 1;
      if (specialSlot === 3) cohortCounts.skills += 1;
      if (specialSlot === 4) cohortCounts.companyName += 1;
    }
    cursor = result.nextCursor ?? undefined;
    if (pages > Math.ceil(total / limit) + 1) fail(`${label} did not terminate`);
  } while (cursor);
  if (ids.length !== total || seen.size !== total) {
    fail(`${label} traversal expected ${total} unique IDs, got ${ids.length}`);
  }
  return { ids, pages, cohortCounts, facets: firstFacets };
};

const percentile = (sorted, ratio) =>
  sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const openSearchContexts = async (elastic) => {
  const stats = await elastic.nodes.stats({
    metric: 'indices',
    index_metric: 'search',
  });
  return Object.values(stats.nodes ?? {}).reduce(
    (total, node) => total + (node.indices?.search?.open_contexts ?? 0),
    0,
  );
};

const readOpenSearchContexts = async () => {
  const elastic = new Client({
    node: config.elasticsearchNode,
    requestTimeout: 10000,
    maxRetries: 0,
  });
  try {
    return await openSearchContexts(elastic);
  } finally {
    await elastic.close();
  }
};

const benchmark = async (baselineOpenContexts) => {
  const chainTotal = config.dataset / 20;
  const pagesPerChain = chainTotal / 50;
  if (!Number.isSafeInteger(pagesPerChain) || pagesPerChain < 1) {
    fail('benchmark cursor-chain page count is invalid');
  }
  const chainQueries = [
    ...LOCATIONS.map((location) => ({
      q: SPECIAL_TEXT,
      location,
      sort: 'RELEVANCE',
      pagination: 'CURSOR',
      limit: 50,
    })),
    ...JOB_TYPES.map((jobType) => ({
      q: SPECIAL_TEXT,
      jobType,
      sort: 'RELEVANCE',
      pagination: 'CURSOR',
      limit: 50,
    })),
  ];
  const execute = async (count, record) => {
    const completeChains = Math.floor(count / pagesPerChain);
    const singleRequests = count % pagesPerChain;
    const tasks = [
      ...Array.from({ length: completeChains }, (_, index) => ({
        kind: 'chain',
        index,
      })),
      ...Array.from({ length: singleRequests }, (_, index) => ({
        kind: 'single',
        index,
      })),
    ];
    let nextTask = 0;
    let errors = 0;
    let sourceMismatches = 0;
    let maximumBodyBytes = 0;
    const latencies = [];
    const samples = [];
    const elastic = new Client({
      node: config.elasticsearchNode,
      requestTimeout: 10000,
      maxRetries: 0,
    });
    let monitorRunning = true;
    let monitorError;
    let maximumOpenContexts = baselineOpenContexts;
    const monitor = (async () => {
      while (monitorRunning) {
        try {
          maximumOpenContexts = Math.max(
            maximumOpenContexts,
            await openSearchContexts(elastic),
          );
        } catch (error) {
          monitorError = error;
          return;
        }
        await delay(25);
      }
    })();
    const startedAt = performance.now();
    const workers = Array.from(
      { length: Math.min(config.concurrency, Math.max(tasks.length, 1)) },
      async () => {
        while (true) {
          const taskIndex = nextTask;
          nextTask += 1;
          if (taskIndex >= tasks.length) return;
          const task = tasks[taskIndex];
          if (task.kind === 'single') {
            try {
              const response = await requestJson(searchPath({
                q: `no-match-benchmark-${task.index}`,
                pagination: 'CURSOR',
                limit: 50,
              }));
              assertSearchResponse(response, {
                total: 0,
                page: 1,
                limit: 50,
                cursorMode: true,
              });
              if (record) {
                latencies.push(response.durationMs);
                maximumBodyBytes = Math.max(maximumBodyBytes, response.bytes);
              }
            } catch (error) {
              errors += 1;
              const message = error instanceof Error ? error.message : String(error);
              if (message.includes('SOURCE_MISMATCH')) sourceMismatches += 1;
              if (samples.length < 5) samples.push(message.slice(0, 240));
            }
            continue;
          }
          const scope = chainQueries[task.index % chainQueries.length];
          let cursor;
          for (let page = 1; page <= pagesPerChain; page += 1) {
            try {
              const response = await requestJson(searchPath({
                ...scope,
                ...(cursor ? { cursor } : {}),
              }));
              const { result } = assertSearchResponse(response, {
                total: chainTotal,
                page,
                limit: 50,
                cursorMode: true,
              });
              cursor = result.nextCursor ?? undefined;
              if (page < pagesPerChain && !cursor) {
                fail(`benchmark cursor chain ended on page ${page}`);
              }
              if (page === pagesPerChain && cursor) {
                fail('benchmark cursor chain did not close at its terminal page');
              }
              if (record) {
                latencies.push(response.durationMs);
                maximumBodyBytes = Math.max(maximumBodyBytes, response.bytes);
              }
            } catch (error) {
              errors += 1;
              const message = error instanceof Error ? error.message : String(error);
              if (message.includes('SOURCE_MISMATCH')) sourceMismatches += 1;
              if (samples.length < 5) samples.push(message.slice(0, 240));
              break;
            }
          }
        }
      },
    );
    try {
      await Promise.all(workers);
    } finally {
      monitorRunning = false;
      await monitor;
      await elastic.close();
    }
    if (monitorError) throw monitorError;
    await delay(50);
    const finalOpenContexts = await readOpenSearchContexts();
    return {
      count,
      errors,
      sourceMismatches,
      durationMs: performance.now() - startedAt,
      maximumBodyBytes,
      maximumOpenContexts,
      finalOpenContexts,
      completeChains,
      singleRequests,
      latencies,
      samples,
    };
  };

  const warmup = await execute(config.warmupRequests, false);
  if (
    warmup.errors !== 0 ||
    warmup.sourceMismatches !== 0 ||
    warmup.finalOpenContexts !== baselineOpenContexts ||
    warmup.maximumOpenContexts > baselineOpenContexts + config.concurrency + 2
  ) {
    fail(`benchmark warmup failed: ${warmup.samples.join('; ')}`);
  }
  const measured = await execute(config.measuredRequests, true);
  const sorted = measured.latencies.sort((left, right) => left - right);
  const result = {
    requests: config.measuredRequests,
    concurrency: config.concurrency,
    durationMs: Number(measured.durationMs.toFixed(3)),
    errors: measured.errors,
    sourceMismatches: measured.sourceMismatches,
    requestsPerSecond: Number(
      (config.measuredRequests / (measured.durationMs / 1000)).toFixed(3),
    ),
    p50Ms: Number(percentile(sorted, 0.50).toFixed(3)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
    p99Ms: Number(percentile(sorted, 0.99).toFixed(3)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
    maxBodyBytes: measured.maximumBodyBytes,
    cursorChainsCompleted: measured.completeChains,
    terminalSingleRequests: measured.singleRequests,
    baselineOpenContexts,
    maximumOpenContexts: measured.maximumOpenContexts,
    finalOpenContexts: measured.finalOpenContexts,
    errorSamples: measured.samples,
  };
  if (
    result.errors !== 0 ||
    result.sourceMismatches !== 0 ||
    sorted.length !== config.measuredRequests ||
    result.p95Ms > config.maxP95Ms ||
    result.p99Ms > config.maxP99Ms ||
    result.requestsPerSecond < config.minRequestsPerSecond ||
    result.maxBodyBytes > config.maxBodyBytes ||
    result.finalOpenContexts !== baselineOpenContexts ||
    result.maximumOpenContexts > baselineOpenContexts + config.concurrency + 2
  ) {
    fail(`benchmark thresholds failed: ${JSON.stringify(result)}`);
  }
  return result;
};

const countPublic = (predicate) => {
  let count = 0;
  for (let sequence = 1; sequence <= config.dataset; sequence += 1) {
    if (isPublic(sequence) && predicate(fixture(sequence))) count += 1;
  }
  return count;
};

const verify = async () => {
  const publicTotal = config.dataset * 4 / 5;
  const vietnameseTotal = config.dataset / 5;
  const expectedFixtureFingerprint = fixtureFingerprint();
  if (config.postgresFingerprint !== expectedFixtureFingerprint) {
    fail(
      `PostgreSQL/runner fixture fingerprint mismatch: ` +
      `${config.postgresFingerprint || '<missing>'} != ${expectedFixtureFingerprint}`,
    );
  }
  const elastic = new Client({
    node: config.elasticsearchNode,
    requestTimeout: 10000,
    maxRetries: 0,
  });
  let mapping;
  try {
    mapping = await mappingContract(elastic);
    const total = (await elastic.count({ index: config.elasticsearchIndex })).count;
    const searchable = (await elastic.count({
      index: config.elasticsearchIndex,
      query: { term: { searchable: true } },
    })).count;
    if (total !== config.dataset || searchable !== publicTotal) {
      fail(`Elasticsearch count drift: total=${total}, searchable=${searchable}`);
    }
  } finally {
    await elastic.close();
  }

  const health = await requestJson('/health');
  if (
    health.status !== 200 ||
    health.body?.data?.searchIndexReady !== true ||
    health.body?.meta !== null
  ) {
    fail(`Job API search index is not ready: ${JSON.stringify(health.body).slice(0, 300)}`);
  }

  const baselineOpenContexts = await readOpenSearchContexts();
  if (baselineOpenContexts !== 0) {
    fail(`isolated Elasticsearch started with ${baselineOpenContexts} open search contexts`);
  }

  const first = await getSearch({ sort: 'NEWEST', limit: 20 }, {
    total: publicTotal,
    limit: 20,
    page: 1,
  });
  assertFacets(first.result.facets, expectedPublicFacets(), 'public');

  const vietnameseFirst = await getSearch({
    q: SPECIAL_TEXT,
    sort: 'RELEVANCE',
    limit: 20,
  }, { total: vietnameseTotal, limit: 20, page: 1 });
  assertFacets(
    vietnameseFirst.result.facets,
    expectedVietnameseFacets(),
    'Vietnamese',
  );

  const filterCases = [
    [{ location: 'da nang', limit: 20 }, config.dataset / 5],
    [{ skills: 'NestJS', limit: 20 }, config.dataset / 5],
    [{ jobType: 'REMOTE', limit: 20 }, config.dataset / 5],
    [{ companyId: companyId(1), limit: 20 }, config.dataset / 20],
    [{ experienceYears: 3, limit: 20 }, config.dataset * 2 / 5],
    [{ q: SPECIAL_TEXT, location: 'ha noi', limit: 20 }, config.dataset / 20],
    [{ salaryMin: 20000000, salaryMax: 22000000, limit: 20 },
      countPublic((job) => job.isNegotiable ||
        (job.salaryMax >= 20000000 && job.salaryMin <= 22000000))],
  ];
  for (const [query, expectedTotal] of filterCases) {
    await getSearch(query, { total: expectedTotal, limit: 20, page: 1 });
  }
  const hidden = await getSearch({ q: PRIVATE_MARKER, limit: 20 }, {
    total: 0,
    limit: 20,
    page: 1,
  });
  if (hidden.result.items.length !== 0 || hidden.result.hasMore) {
    fail('private-field query returned a public card or continuation');
  }

  const hiddenStatus = await getSearch({ q: HIDDEN_STATUS_MARKER, limit: 20 }, {
    total: 0,
    limit: 20,
    page: 1,
  });
  if (hiddenStatus.result.items.length !== 0 || hiddenStatus.result.hasMore) {
    fail('non-public Job status leaked through the HTTP search API');
  }

  await collectAll({
    label: 'NEWEST terminal traversal',
    query: { companyId: companyId(1), sort: 'NEWEST' },
    total: config.dataset / 20,
    sort: 'NEWEST',
    expectedSequence: (sequence) => slot(sequence) === 1,
  });
  await collectAll({
    label: 'SALARY_DESC terminal traversal',
    query: { companyId: companyId(2), sort: 'SALARY_DESC' },
    total: config.dataset / 20,
    sort: 'SALARY_DESC',
    limit: 49,
    expectedSequence: (sequence) => slot(sequence) === 2,
  });

  const variants = [
    ['NFC', SPECIAL_TEXT],
    ['NFD', SPECIAL_TEXT.normalize('NFD')],
    ['accentless', 'ky su du lieu da nang'],
  ];
  const traversals = [];
  for (const [label, queryText] of variants) {
    const traversal = await collectAll({
      label: `${label} Vietnamese traversal`,
      query: { q: queryText, sort: 'RELEVANCE' },
      total: vietnameseTotal,
      sort: 'RELEVANCE',
      expectedSequence: (sequence) => slot(sequence) >= 1 && slot(sequence) <= 4,
    });
    assertFacets(traversal.facets, expectedVietnameseFacets(), label);
    sameRecord(traversal.cohortCounts, {
      title: config.dataset / 20,
      description: config.dataset / 20,
      skills: config.dataset / 20,
      companyName: config.dataset / 20,
    }, `${label} field cohorts`);
    if (traversal.ids.length <= 10000 || traversal.pages <= 200) {
      fail(`${label} traversal did not cross the 10,000-result boundary`);
    }
    traversals.push(traversal);
  }
  const canonicalIds = traversals[0].ids.join('\n');
  for (const traversal of traversals.slice(1)) {
    if (traversal.ids.join('\n') !== canonicalIds) {
      fail('Vietnamese NFC/NFD/accentless traversals returned different ordered IDs');
    }
  }

  await delay(50);
  const correctnessFinalOpenContexts = await readOpenSearchContexts();
  if (correctnessFinalOpenContexts !== baselineOpenContexts) {
    fail(
      `PIT leak after correctness checks: baseline=${baselineOpenContexts}, ` +
      `final=${correctnessFinalOpenContexts}`,
    );
  }
  const benchmarkResult = await benchmark(baselineOpenContexts);
  const report = {
    gate: 'job-search-load-v1',
    dataset: {
      total: config.dataset,
      public: publicTotal,
      hiddenPerStatus: config.dataset / 20,
      vietnameseAcrossFourFields: vietnameseTotal,
      postgresFingerprint: config.postgresFingerprint,
      fixtureFingerprint: expectedFixtureFingerprint,
    },
    runtime: {
      applicationImageId: config.applicationImageId,
      postgresImageId: config.postgresImageId,
      postgresImageRef: config.postgresImageRef,
      redisImageId: config.redisImageId,
      redisImageRef: config.redisImageRef,
      elasticsearchImageId: config.elasticsearchImageId,
      elasticsearchImageRef: config.elasticsearchImageRef,
      nodeImage: config.nodeImage,
      elasticsearchConcreteIndex: mapping.concreteIndex,
      analyzerTokens: mapping.analyzerTokens,
      requestTimeoutMs: config.requestTimeoutMs,
      maxBodyBytes: config.maxBodyBytes,
    },
    correctness: {
      publicTotalAndFacets: 'PASS',
      statusIsolationAndCardPrivacy: 'PASS',
      filtersAndSorts: 'PASS',
      vietnameseForms: variants.map(([label]) => label),
      vietnamesePagesPerForm: traversals[0].pages,
      deepRowsPerForm: traversals[0].ids.length,
      deterministicOrderNoDuplicatesNoMissing: 'PASS',
      pitOpenContexts: {
        baseline: baselineOpenContexts,
        afterCorrectness: correctnessFinalOpenContexts,
      },
      source: 'ELASTICSEARCH',
    },
    thresholds: {
      maxP95Ms: config.maxP95Ms,
      maxP99Ms: config.maxP99Ms,
      minRequestsPerSecond: config.minRequestsPerSecond,
      errors: 0,
      sourceMismatches: 0,
      maximumOpenContexts: baselineOpenContexts + config.concurrency + 2,
    },
    benchmark: benchmarkResult,
    status: 'PASS',
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stdout.write(
    `[job-search-load] PASS ${config.dataset} rows; ` +
    `${benchmarkResult.requests} requests; p95=${benchmarkResult.p95Ms}ms; ` +
    `p99=${benchmarkResult.p99Ms}ms; rps=${benchmarkResult.requestsPerSecond}\n`,
  );
};

const main = config.phase === 'seed' ? seedElasticsearch : verify;
main()
  .catch((error) => {
    process.stderr.write(
      `[job-search-load] ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => agent.destroy());
