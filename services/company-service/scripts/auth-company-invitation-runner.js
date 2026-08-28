'use strict';

const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 180_000;
const STATE_PATH = '/state/auth-company-state.json';
const RUN_ID_PATTERN = /^[0-9a-f-]{16,64}$/;
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JWT_PATTERN =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const PASSWORD = 'CompanyAuth!2026';
const USERS = Object.freeze({
  owner: Object.freeze({
    id: '10000000-0000-4000-8000-000000000001',
    email: 'owner.integration@example.test',
  }),
  thief: Object.freeze({
    id: '10000000-0000-4000-8000-000000000002',
    email: 'thief.integration@example.test',
  }),
  intended: Object.freeze({
    id: '10000000-0000-4000-8000-000000000003',
    email: 'intended.integration@example.test',
  }),
  locked: Object.freeze({
    id: '10000000-0000-4000-8000-000000000004',
    email: 'locked.integration@example.test',
  }),
  deleted: Object.freeze({
    id: '10000000-0000-4000-8000-000000000005',
    email: 'deleted.integration@example.test',
  }),
  role: Object.freeze({
    id: '10000000-0000-4000-8000-000000000006',
    email: 'role.integration@example.test',
  }),
  email: Object.freeze({
    id: '10000000-0000-4000-8000-000000000007',
    email: 'email.integration@example.test',
  }),
  outage: Object.freeze({
    id: '10000000-0000-4000-8000-000000000008',
    email: 'outage.integration@example.test',
  }),
  race: Object.freeze({
    id: '10000000-0000-4000-8000-000000000009',
    email: 'race.integration@example.test',
  }),
});
const USER_KEYS = Object.freeze(Object.keys(USERS));
const INVITATION_KEYS = Object.freeze([
  'intended',
  'locked',
  'deleted',
  'role',
  'email',
  'outage',
  'race',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, expected, subject) {
  invariant(isRecord(value), `${subject} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(
    actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    `${subject} has an unexpected shape`,
  );
}

function requiredEnv(name) {
  const value = process.env[name];
  invariant(typeof value === 'string' && value.length > 0, `${name} is required`);
  return value;
}

function readRunId() {
  const runId = requiredEnv('INTEGRATION_RUN_ID');
  invariant(RUN_ID_PATTERN.test(runId), 'INTEGRATION_RUN_ID is invalid');
  return runId;
}

function readBaseUrl(prefix, runId) {
  const raw = requiredEnv(`${prefix}_BASE_URL`);
  const expectedHost = requiredEnv(`EXPECTED_${prefix}_HOST`);
  invariant(
    HOST_PATTERN.test(expectedHost) && expectedHost.endsWith(`-${runId}`),
    `EXPECTED_${prefix}_HOST is invalid`,
  );
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${prefix}_BASE_URL is invalid`);
  }
  invariant(
    parsed.protocol === 'http:' &&
      parsed.hostname === expectedHost &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.origin === raw,
    `${prefix}_BASE_URL is outside the disposable network`,
  );
  return raw;
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  invariant(
    /^application\/json(?:\s*;|$)/i.test(contentType),
    'response content type is not JSON',
  );
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    invariant(/^\d+$/.test(declaredLength), 'response content length is invalid');
    invariant(
      Number(declaredLength) <= MAX_RESPONSE_BYTES,
      'response exceeded the declared size limit',
    );
  }
  invariant(response.body !== null, 'response body is missing');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('response exceeded the streaming size limit');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, size),
      ),
    );
  } catch {
    throw new Error('response body is not valid UTF-8 JSON');
  }
  invariant(isRecord(payload), 'response JSON must be an object');
  return payload;
}

async function requestJson(baseUrl, path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = { Accept: 'application/json' };
  if (options.token !== undefined) {
    invariant(JWT_PATTERN.test(options.token), 'request access token is invalid');
    headers.Authorization = `Bearer ${options.token}`;
  }
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(new URL(path, `${baseUrl}/`), {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`${method} ${path} transport failed`);
  }
  const payload = await readResponseBody(response);
  return { headers: response.headers, payload, status: response.status };
}

function decodeJwtPart(part, subject) {
  let decoded;
  try {
    const bytes = Buffer.from(part, 'base64url');
    invariant(bytes.toString('base64url') === part, `${subject} is not canonical`);
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('is not canonical')) {
      throw error;
    }
    throw new Error(`${subject} is invalid`);
  }
  invariant(isRecord(decoded), `${subject} must be an object`);
  return decoded;
}

function assertAccessToken(token, user, issuer, audience) {
  invariant(typeof token === 'string' && JWT_PATTERN.test(token), 'login did not return a JWT');
  invariant(Buffer.byteLength(token, 'utf8') <= 8192, 'login JWT is too large');
  const parts = token.split('.');
  const header = decodeJwtPart(parts[0], 'JWT header');
  const claims = decodeJwtPart(parts[1], 'JWT claims');
  invariant(
    header.alg === 'RS256' &&
      header.typ === 'JWT' &&
      typeof header.kid === 'string' &&
      header.kid.length > 0,
    'login JWT header is not canonical RS256',
  );
  const audienceMatches =
    claims.aud === audience ||
    (Array.isArray(claims.aud) &&
      claims.aud.length === 1 &&
      claims.aud[0] === audience);
  invariant(
    claims.iss === issuer &&
      claims.sub === user.id &&
      claims.role === 'RECRUITER' &&
      audienceMatches &&
      Number.isInteger(claims.iat) &&
      Number.isInteger(claims.exp) &&
      claims.exp > claims.iat &&
      typeof claims.jti === 'string' &&
      UUID_V4_PATTERN.test(claims.jti),
    'login JWT claims do not match the integration contract',
  );
}

function assertCompanyEnvelope(result, expectedStatus) {
  invariant(result.status === expectedStatus, `Company returned HTTP ${result.status}`);
  exactKeys(result.payload, ['data', 'meta'], 'Company success envelope');
  invariant(result.payload.meta === null, 'Company success meta must be null');
  invariant(isRecord(result.payload.data), 'Company success data must be an object');
  return result.payload.data;
}

function assertCompanyError(result, expectedStatus, expectedCode) {
  invariant(result.status === expectedStatus, `Company returned HTTP ${result.status}`);
  exactKeys(result.payload, ['code', 'details', 'message'], 'Company error envelope');
  invariant(result.payload.code === expectedCode, `Company returned ${String(result.payload.code)}`);
  invariant(typeof result.payload.message === 'string', 'Company error message is invalid');
}

async function login(authBaseUrl, user, issuer, audience) {
  const result = await requestJson(authBaseUrl, '/auth/login', {
    method: 'POST',
    body: { email: user.email, password: PASSWORD },
  });
  invariant(result.status === 200, `Auth login returned HTTP ${result.status}`);
  exactKeys(result.payload, ['data', 'meta'], 'Auth login envelope');
  invariant(
    isRecord(result.payload.meta) && Object.keys(result.payload.meta).length === 0,
    'Auth login meta must be empty',
  );
  const data = result.payload.data;
  invariant(isRecord(data) && isRecord(data.user), 'Auth login data is invalid');
  invariant(
    data.tokenType === 'Bearer' &&
      typeof data.refreshToken === 'string' &&
      data.refreshToken.startsWith('rt1_') &&
      Number.isInteger(data.accessTokenExpiresInSeconds) &&
      data.accessTokenExpiresInSeconds > 0 &&
      data.user.id === user.id &&
      data.user.email === user.email &&
      data.user.role === 'RECRUITER',
    'Auth login identity or token response is invalid',
  );
  invariant(
    (result.headers.get('cache-control') ?? '').includes('no-store'),
    'Auth login response is cacheable',
  );
  assertAccessToken(data.accessToken, user, issuer, audience);
  return data.accessToken;
}

function writeState(state) {
  invariant(requiredEnv('STATE_PATH') === STATE_PATH, 'STATE_PATH is not allow-listed');
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    fs.constants.O_NOFOLLOW;
  const descriptor = fs.openSync(STATE_PATH, flags, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(state)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateState(state, runId) {
  exactKeys(
    state,
    ['companyId', 'invitations', 'runId', 'users', 'version'],
    'integration state',
  );
  invariant(state.version === 1 && state.runId === runId, 'integration state sentinel mismatch');
  invariant(UUID_V4_PATTERN.test(state.companyId), 'state company id is invalid');
  exactKeys(state.users, USER_KEYS, 'state users');
  for (const key of USER_KEYS) {
    exactKeys(state.users[key], ['accessToken', 'email', 'id'], `state user ${key}`);
    invariant(
      state.users[key].id === USERS[key].id &&
        state.users[key].email === USERS[key].email &&
        typeof state.users[key].accessToken === 'string' &&
        JWT_PATTERN.test(state.users[key].accessToken) &&
        Buffer.byteLength(state.users[key].accessToken, 'utf8') <= 8192,
      `state user ${key} is invalid`,
    );
  }
  exactKeys(state.invitations, INVITATION_KEYS, 'state invitations');
  for (const key of INVITATION_KEYS) {
    exactKeys(state.invitations[key], ['email', 'token'], `state invitation ${key}`);
    invariant(
      state.invitations[key].email === USERS[key].email &&
        typeof state.invitations[key].token === 'string' &&
        INVITATION_TOKEN_PATTERN.test(state.invitations[key].token),
      `state invitation ${key} is invalid`,
    );
  }
  return state;
}

function readState(runId) {
  invariant(requiredEnv('STATE_PATH') === STATE_PATH, 'STATE_PATH is not allow-listed');
  const metadata = fs.lstatSync(STATE_PATH);
  invariant(metadata.isFile() && !metadata.isSymbolicLink(), 'state path is not a regular file');
  invariant((metadata.mode & 0o077) === 0, 'state file permissions are too broad');
  invariant(metadata.size > 0 && metadata.size <= 128 * 1024, 'state file size is invalid');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    throw new Error('state file is not valid JSON');
  }
  return validateState(state, runId);
}

async function acceptInvitation(companyBaseUrl, state, userKey, invitationKey) {
  return requestJson(companyBaseUrl, '/invitations/accept', {
    method: 'POST',
    token: state.users[userKey].accessToken,
    body: { token: state.invitations[invitationKey].token },
  });
}

function assertMembership(result, state, userKey) {
  const data = assertCompanyEnvelope(result, 200);
  invariant(
    data.companyId === state.companyId &&
      data.memberRole === 'MEMBER' &&
      data.verifiedStatus === 'PENDING' &&
      typeof data.name === 'string' &&
      data.name.length > 0,
    `membership response for ${userKey} is invalid`,
  );
  return data;
}

async function phaseReady(authBaseUrl, companyBaseUrl) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let authReady = false;
  let companyReady = false;
  while (Date.now() < deadline) {
    if (!authReady) {
      try {
        const result = await requestJson(authBaseUrl, '/actuator/health', { timeoutMs: 2000 });
        authReady = result.status === 200;
      } catch {
        authReady = false;
      }
    }
    if (!companyReady) {
      try {
        const result = await requestJson(companyBaseUrl, '/health', { timeoutMs: 2000 });
        companyReady = result.status === 200;
      } catch {
        companyReady = false;
      }
    }
    if (authReady && companyReady) return { authReady, companyReady };
    await delay(1000);
  }
  throw new Error('Auth and Company did not become ready before the deadline');
}

async function phaseSetup(authBaseUrl, companyBaseUrl, runId, issuer, audience) {
  const users = {};
  for (const key of USER_KEYS) {
    users[key] = {
      ...USERS[key],
      accessToken: await login(authBaseUrl, USERS[key], issuer, audience),
    };
  }

  const suffix = runId.replaceAll('-', '').slice(-20);
  const created = await requestJson(companyBaseUrl, '/', {
    method: 'POST',
    token: users.owner.accessToken,
    body: {
      name: `Auth Binding Integration ${runId}`,
      description: 'Disposable Auth and Company invitation binding integration fixture',
      industry: 'Software testing',
      size: '1-10',
      address: 'Disposable internal Docker network',
      website: 'https://integration.example.test',
      taxCode: `IT${suffix}`,
    },
  });
  const company = assertCompanyEnvelope(created, 201);
  invariant(UUID_V4_PATTERN.test(company.id), 'Company create returned an invalid id');

  const invitations = {};
  for (const key of INVITATION_KEYS) {
    const result = await requestJson(companyBaseUrl, `/${company.id}/members`, {
      method: 'POST',
      token: users.owner.accessToken,
      body: { email: USERS[key].email },
    });
    const invitation = assertCompanyEnvelope(result, 201);
    invariant(
      invitation.companyId === company.id &&
        invitation.email === USERS[key].email &&
        invitation.status === 'PENDING' &&
        typeof invitation.invitationToken === 'string' &&
        INVITATION_TOKEN_PATTERN.test(invitation.invitationToken),
      `Company invitation for ${key} is invalid`,
    );
    invitations[key] = {
      email: USERS[key].email,
      token: invitation.invitationToken,
    };
  }

  writeState({ version: 1, runId, companyId: company.id, users, invitations });
  return { actualLogins: USER_KEYS.length, invitations: INVITATION_KEYS.length };
}

async function phaseStolen(companyBaseUrl, state) {
  const result = await acceptInvitation(companyBaseUrl, state, 'thief', 'intended');
  assertCompanyError(result, 403, 'INVITATION_EMAIL_MISMATCH');
  return { rejected: 1 };
}

async function phaseIntended(companyBaseUrl, state) {
  const first = assertMembership(
    await acceptInvitation(companyBaseUrl, state, 'intended', 'intended'),
    state,
    'intended',
  );
  const second = assertMembership(
    await acceptInvitation(companyBaseUrl, state, 'intended', 'intended'),
    state,
    'intended',
  );
  invariant(JSON.stringify(first) === JSON.stringify(second), 'idempotent accept response changed');
  return { accepted: 1, idempotentReplays: 1 };
}

async function phaseDurable(companyBaseUrl, state) {
  const cases = [
    ['locked', 403, 'AUTH_ACCOUNT_INACTIVE'],
    ['deleted', 401, 'AUTH_ACCOUNT_INVALID'],
    ['role', 403, 'INVITATION_ACCEPTANCE_FORBIDDEN'],
    ['email', 403, 'INVITATION_EMAIL_MISMATCH'],
  ];
  for (const [key, status, code] of cases) {
    const result = await acceptInvitation(companyBaseUrl, state, key, key);
    assertCompanyError(result, status, code);
  }
  return { rejectedDurableIdentityChanges: cases.length };
}

async function phaseConcurrency(companyBaseUrl, state) {
  const attempts = 8;
  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      acceptInvitation(companyBaseUrl, state, 'race', 'race'),
    ),
  );
  let successes = 0;
  let conflicts = 0;
  for (const result of results) {
    if (result.status === 200) {
      assertMembership(result, state, 'race');
      successes += 1;
      continue;
    }
    invariant(result.status === 409, `concurrent accept returned HTTP ${result.status}`);
    invariant(
      result.payload.code === 'COMPANY_MEMBER_CONFLICT' ||
        result.payload.code === 'RECRUITER_ALREADY_HAS_COMPANY',
      `concurrent accept returned ${String(result.payload.code)}`,
    );
    conflicts += 1;
  }
  invariant(successes >= 1, 'no concurrent invitation accept succeeded');
  assertMembership(
    await acceptInvitation(companyBaseUrl, state, 'race', 'race'),
    state,
    'race',
  );
  return { attempts, conflicts, successes, convergentReplay: 1 };
}

async function phaseOutage(companyBaseUrl, state) {
  const result = await acceptInvitation(companyBaseUrl, state, 'outage', 'outage');
  assertCompanyError(result, 503, 'AUTH_SERVICE_UNAVAILABLE');
  return { rejectedWhileAuthUnavailable: 1 };
}

async function main() {
  const runId = readRunId();
  const phase = requiredEnv('INTEGRATION_PHASE');
  invariant(
    ['ready', 'setup', 'stolen', 'intended', 'durable', 'concurrency', 'outage'].includes(phase),
    'INTEGRATION_PHASE is not allow-listed',
  );
  const authBaseUrl = readBaseUrl('AUTH', runId);
  const companyBaseUrl = readBaseUrl('COMPANY', runId);
  const issuer = requiredEnv('EXPECTED_JWT_ISSUER');
  const audience = requiredEnv('EXPECTED_JWT_AUDIENCE');

  let evidence;
  if (phase === 'ready') {
    evidence = await phaseReady(authBaseUrl, companyBaseUrl);
  } else if (phase === 'setup') {
    evidence = await phaseSetup(
      authBaseUrl,
      companyBaseUrl,
      runId,
      issuer,
      audience,
    );
  } else {
    const state = readState(runId);
    if (phase === 'stolen') evidence = await phaseStolen(companyBaseUrl, state);
    if (phase === 'intended') evidence = await phaseIntended(companyBaseUrl, state);
    if (phase === 'durable') evidence = await phaseDurable(companyBaseUrl, state);
    if (phase === 'concurrency') evidence = await phaseConcurrency(companyBaseUrl, state);
    if (phase === 'outage') evidence = await phaseOutage(companyBaseUrl, state);
  }

  process.stdout.write(
    `${JSON.stringify({ harness: 'auth-company-invitation', phase, status: 'PASS', evidence })}\n`,
  );
  process.stdout.write(`[auth-company-integration] PASS: ${phase}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown runner failure';
  process.stderr.write(`[auth-company-integration] ERROR: ${message}\n`);
  process.exitCode = 1;
});
