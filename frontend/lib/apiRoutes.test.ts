import assert from "node:assert/strict";
import test from "node:test";
import { apiPath, apiUrl } from "./apiRoutes";
import { ApiClientError, requestApi } from "./apiClientCore";

test("browser and SSR API URLs share one /api prefix with either gateway configuration", () => {
  for (const path of ["/companies/id", "/api/companies/id"]) {
    assert.equal(apiUrl(path), "/api/companies/id");
    for (const gateway of ["http://api-gateway:8080", "http://api-gateway:8080/", "http://api-gateway:8080/api/"]) {
      assert.equal(apiUrl(path, gateway), "http://api-gateway:8080/api/companies/id");
    }
  }
  assert.equal(apiPath("/api/jobs/search"), "/api/jobs/search");
  assert.equal(apiPath("/applications/"), "/api/applications/");
});

test("API routing rejects external URLs and traversal into page routes", () => {
  for (const path of ["jobs", "https://example.test/jobs", "//example.test/jobs", "/api/../companies/id", "/api/%2e%2e/companies/id", "/api/jobs#fragment", "/api\\jobs"]) {
    assert.throws(() => apiPath(path));
  }
});

test("SSR requests use canonical API URLs and never persist HTML responses", async () => {
  const previous = process.env.API_INTERNAL_BASE_URL;
  process.env.API_INTERNAL_BASE_URL = "http://api-gateway:8080/api/";
  const calls: string[] = [];
  try {
    const fetcher: typeof fetch = async (input, options) => {
      calls.push(String(input));
      assert.equal(options?.cache, "no-store");
      return calls.length === 1
        ? new Response("<html>Wrong page</html>", { headers: { "Content-Type": "text/html" } })
        : new Response(JSON.stringify({ data: { id: "company" } }), { headers: { "Content-Type": "application/json" } });
    };
    await assert.rejects(requestApi("/api/companies/company", { fetcher }),
      (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_API_RESPONSE");
    assert.deepEqual((await requestApi("/companies/company", { fetcher })).data, { id: "company" });
    assert.deepEqual(calls, ["http://api-gateway:8080/api/companies/company", "http://api-gateway:8080/api/companies/company"]);
  } finally {
    if (previous === undefined) delete process.env.API_INTERNAL_BASE_URL;
    else process.env.API_INTERNAL_BASE_URL = previous;
  }
});
