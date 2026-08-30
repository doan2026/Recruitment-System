import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiClientError,
  assertCanonicalUuidV4,
  buildQuery,
  collectionPath,
  getApiSessionRevision,
  parseRetryAfter,
  requestApi,
  selectContractFields,
  setApiAccessToken,
} from "./apiClientCore";

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
