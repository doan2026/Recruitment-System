import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiClientError,
  assertCanonicalUuidV4,
  clearApiSession,
  buildQuery,
  collectionPath,
  getApiSessionRevision,
  parseRetryAfter,
  requestApi,
  selectContractFields,
  setApiAccessToken,
  setApiSession,
  subscribeToApiSession,
} from "./apiClientCore";
import {
  isOptimisticConflict,
  prepareConflictSnapshot,
} from "./conflictRecovery";
import { createTransientRecoveryPlan } from "./transientRecovery";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://gateway.test";

test("collection paths always preserve the gateway trailing slash", () => {
  assert.equal(collectionPath("/applications"), "/applications/");
  assert.equal(collectionPath("/jobs/"), "/jobs/");
});

test("canonical UUID v4 accepts lowercase only", () => {
  const uuid = "018f47a2-6f4d-4b7d-8c91-ff02d770a944";
  assert.equal(assertCanonicalUuidV4(uuid), uuid);
  assert.throws(
    () => assertCanonicalUuidV4(uuid.toUpperCase()),
    (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_UUID_V4",
  );
});

test("query and body allowlists reject unknown fields", () => {
  assert.equal(buildQuery({ page: 2, limit: 20 }, ["page", "limit"]), "?page=2&limit=20");
  assert.throws(
    () => selectContractFields({ page: 1, debug: true }, ["page"]),
    (error: unknown) => error instanceof ApiClientError && error.code === "UNKNOWN_REQUEST_FIELD",
  );
});

test("Retry-After supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("60"), 60);
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:00:05 GMT", Date.UTC(2026, 0, 1)), 5);
  assert.equal(parseRetryAfter("invalid"), null);
});

test("successful gateway response unwraps data and meta", async () => {
  const response = await requestApi<{ id: string }>("/jobs/search", {
    fetcher: async () => new Response(JSON.stringify({ data: { id: "job" }, meta: { source: "POSTGRESQL" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(response, { data: { id: "job" }, meta: { source: "POSTGRESQL" } });
});

test("gateway errors expose safe code mapping and retry metadata, not raw message", async () => {
  await assert.rejects(
    requestApi("/jobs/recommended", {
      maxRetries: 0,
      fetcher: async () => new Response(JSON.stringify({
        code: "GATEWAY_RATE_LIMITED",
        message: "nginx internal upstream details",
      }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 60);
      assert.equal(error.recovery, "retry-after");
      assert.doesNotMatch(error.message, /nginx|upstream/i);
      return true;
    },
  );
});

test("private requests stay no-store and 401 clears the in-memory session", async () => {
  setApiAccessToken("access-token");
  const revisionBeforeRequest = getApiSessionRevision();
  let captured: RequestInit | undefined;

  await assert.rejects(
    requestApi("/applications/my", {
      privateData: true,
      maxRetries: 0,
      fetcher: async (_input, init) => {
        captured = init;
        return new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "raw" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      },
    }),
    (error: unknown) => error instanceof ApiClientError && error.status === 401,
  );

  const headers = new Headers(captured?.headers);
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  assert.equal(headers.get("authorization"), "Bearer access-token");
  assert.equal(headers.get("cache-control"), "no-store");
  assert.ok(getApiSessionRevision() > revisionBeforeRequest);
});

test("cookie-only private session still uses credentials and no-store", async () => {
  setApiSession({ accountId: "cookie-candidate" });
  let captured: RequestInit | undefined;
  await requestApi("/jobs/recommended", {
    privateData: true,
    maxRetries: 0,
    fetcher: async (_input, init) => {
      captured = init;
      return new Response(JSON.stringify({ data: [], meta: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const headers = new Headers(captured?.headers);
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("cache-control"), "no-store");
  clearApiSession();
});

test("session boundary changes on account switch and logout, not same-account refresh", () => {
  clearApiSession();
  const revisions: number[] = [];
  const unsubscribe = subscribeToApiSession((revision) => revisions.push(revision));
  const before = getApiSessionRevision();

  setApiSession({ token: "candidate-token-1", accountId: "candidate-1" });
  const afterLogin = getApiSessionRevision();
  assert.equal(afterLogin, before + 1);

  setApiSession({ token: "candidate-token-2", accountId: "candidate-1" });
  assert.equal(getApiSessionRevision(), afterLogin);

  setApiSession({ token: "recruiter-token", accountId: "recruiter-1" });
  assert.equal(getApiSessionRevision(), afterLogin + 1);

  clearApiSession();
  assert.equal(getApiSessionRevision(), afterLogin + 2);
  assert.deepEqual(revisions, [afterLogin, afterLogin + 1, afterLogin + 2]);

  unsubscribe();
  setApiSession({ token: "detached-listener-token", accountId: "candidate-2" });
  assert.equal(revisions.length, 3);
  clearApiSession();
});

test("identified session rejects missing account data", () => {
  assert.throws(
    () => setApiSession({ token: "token", accountId: "" }),
    (error: unknown) => error instanceof ApiClientError &&
      error.code === "SESSION_ACCOUNT_REQUIRED" &&
      !/token/i.test(error.message),
  );
});

test("409 optimistic conflict is never retried blindly", async () => {
  let attempts = 0;
  await assert.rejects(
    requestApi("/companies/018f47a2-6f4d-4b7d-8c91-ff02d770a944", {
      method: "PUT",
      body: { name: "Bản của tôi" },
      fetcher: async () => {
        attempts += 1;
        return new Response(JSON.stringify({
          code: "COMPANY_UPDATE_CONFLICT",
          message: "raw database detail",
        }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      },
    }),
    (error: unknown) => isOptimisticConflict(error),
  );
  assert.equal(attempts, 1);
});

test("conflict recovery reloads once and preserves the local draft for comparison", async () => {
  let reloads = 0;
  const error = new ApiClientError({ code: "COMPANY_UPDATE_CONFLICT", status: 409 });
  const snapshot = await prepareConflictSnapshot({
    error,
    localDraft: { name: "Tên tôi nhập", taxCode: "0101" },
    localVersion: 4,
    reload: async () => {
      reloads += 1;
      return { name: "Tên trên server", taxCode: "0101", aggregateVersion: 5 };
    },
    serverVersion: (server) => server.aggregateVersion,
    fields: [
      { key: "name", label: "Tên công ty", localValue: (draft) => draft.name, serverValue: (server) => server.name },
      { key: "taxCode", label: "Mã số thuế", localValue: (draft) => draft.taxCode, serverValue: (server) => server.taxCode },
    ],
  });

  assert.equal(reloads, 1);
  assert.deepEqual(snapshot.localDraft, { name: "Tên tôi nhập", taxCode: "0101" });
  assert.equal(snapshot.localVersion, 4);
  assert.equal(snapshot.serverVersion, 5);
  assert.deepEqual(snapshot.fields.map((field) => field.changed), [true, false]);
});

test("non-optimistic 409 errors are not routed through reload and compare", async () => {
  let reloaded = false;
  const error = new ApiClientError({ code: "OFFER_EXPIRED", status: 409 });
  await assert.rejects(
    prepareConflictSnapshot({
      error,
      localDraft: {},
      reload: async () => {
        reloaded = true;
        return {};
      },
      fields: [],
    }),
    (reason: unknown) => reason === error,
  );
  assert.equal(reloaded, false);
});

test("Retry-After drives one bounded automatic retry before manual recovery", () => {
  const error = new ApiClientError({
    code: "GATEWAY_RATE_LIMITED",
    status: 429,
    retryAfterSeconds: 60,
  });

  assert.deepEqual(createTransientRecoveryPlan(error, 1), {
    source: "retry-after", delaySeconds: 60, automatic: true, status: 429,
  });
  assert.deepEqual(createTransientRecoveryPlan(error, 2), {
    source: "retry-after", delaySeconds: 60, automatic: false, status: 429,
  });
});

test("missing Retry-After uses bounded local backoff and requires a manual retry", () => {
  const error = new ApiClientError({ code: "MEDIA_UPLOAD_RATE_LIMITED", status: 429 });
  assert.equal(createTransientRecoveryPlan(error, 1)?.delaySeconds, 2);
  assert.equal(createTransientRecoveryPlan(error, 4)?.delaySeconds, 16);
  assert.deepEqual(createTransientRecoveryPlan(error, 10), {
    source: "local-backoff", delaySeconds: 30, automatic: false, status: 429,
  });

  const unavailable = new ApiClientError({
    code: "CHAT_PROVIDER_UNAVAILABLE",
    status: 503,
  });
  assert.deepEqual(createTransientRecoveryPlan(unavailable, 1), {
    source: "local-backoff",
    delaySeconds: 2,
    automatic: false,
    status: 503,
  });
});

test("ordinary errors do not enter transient recovery", () => {
  const error = new ApiClientError({ code: "COMPANY_UPDATE_CONFLICT", status: 409 });
  assert.equal(createTransientRecoveryPlan(error), null);
});
