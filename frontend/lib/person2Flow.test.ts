import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  ApiClientError, clearApiSession, configureApiSessionRefresh, getApiSessionAccountId,
  getApiSessionRevision, requestApi, setApiSession,
} from "./apiClientCore";
import { getCurrentAccount, refreshAuthSession, signIn, signOut } from "./authSession";

process.env.NEXT_PUBLIC_API_MODE = "gateway";
process.env.NEXT_PUBLIC_API_BASE_URL = "http://gateway.test";
const originalFetch = globalThis.fetch;
const jobId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const companyId = "3795c0de-7908-4ab5-9bed-4c4f1cf9c212";
const applicationId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c213";
const offerId = "5795c0de-7908-4ab5-9bed-4c4f1cf9c214";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { data, meta: null } : data), { status, headers: { "content-type": "application/json" } });
beforeEach(() => configureApiSessionRefresh(refreshAuthSession));
afterEach(() => { globalThis.fetch = originalFetch; configureApiSessionRefresh(null); clearApiSession(); delete process.env.API_INTERNAL_BASE_URL; });

test("repeated anonymous 401 invalidates protected state once, never an endless remount", async () => {
  setApiSession({ accountId: "cookie-only-candidate" });
  const before = getApiSessionRevision();
  for (let count = 0; count < 4; count += 1) {
    await assert.rejects(requestApi("/applications/my", {
      privateData: true, fetcher: async () => json({ code: "AUTH_INVALID" }, 401),
    }), (error: unknown) => error instanceof ApiClientError && error.status === 401);
  }
  assert.equal(getApiSessionRevision(), before + 1);
  assert.equal(getApiSessionAccountId(), null);
});

for (const status of [200, 401]) test(`late ${status} from old account cannot expose data or clear a new login`, async () => {
  setApiSession({ token: "old-fixture-token", accountId: "old-account" });
  let release!: (response: Response) => void;
  const pending = requestApi("/applications/my", {
    privateData: true, fetcher: () => new Promise((resolve) => { release = resolve; }),
  });
  setApiSession({ token: "new-fixture-token", accountId: "new-account" });
  release(status === 200 ? json([{ private: "old account data" }]) : json({ code: "AUTH_INVALID" }, 401));
  await assert.rejects(pending, (error: unknown) => error instanceof ApiClientError && error.code === "REQUEST_CANCELLED");
  assert.equal(getApiSessionAccountId(), "new-account");
});

test("DELETE success 204 does not require a JSON envelope", async () => {
  const response = await requestApi<void>("/applications/bookmarks/" + jobId, {
    method: "DELETE", fetcher: async () => new Response(null, { status: 204 }),
  });
  assert.deepEqual(response, { data: undefined, meta: null });
});

test("server requests use internal Gateway origin without changing public browser configuration", async () => {
  process.env.API_INTERNAL_BASE_URL = "http://api-gateway";
  let url = "";
  await requestApi("/companies/public-id", { fetcher: async (input) => { url = String(input); return json({}); } });
  assert.equal(url, "http://api-gateway/companies/public-id");
  assert.equal(process.env.NEXT_PUBLIC_API_BASE_URL, "http://gateway.test");
});

test("Auth cookie login, refresh and logout keep credentials out of browser memory", async () => {
  const user = { id: companyId, email: "fixture@example.test", role: "CANDIDATE" };
  const calls: string[] = [];
  let protectedCalls = 0;
  globalThis.fetch = async (input, options) => {
    const url = String(input); calls.push(url);
    if (url.includes("/auth-cookie/")) assert.equal(new Headers(options?.headers).get("authorization"), null);
    if (url.endsWith("/auth-cookie/login")) return json({ user });
    if (url.endsWith("/auth-cookie/refresh")) {
      assert.deepEqual(JSON.parse(String(options?.body)), {});
      return json({ user });
    }
    if (url.endsWith("/auth-cookie/logout")) {
      assert.deepEqual(JSON.parse(String(options?.body)), {});
      return new Response(null, { status: 204 });
    }
    protectedCalls += 1;
    if (protectedCalls === 1) return json({ code: "AUTH_INVALID" }, 401);
    assert.equal(new Headers(options?.headers).get("authorization"), null);
    return json([]);
  };
  await signIn(user.email, "fixture-password");
  assert.deepEqual(getCurrentAccount(), user);
  await requestApi("/applications/my", { privateData: true });
  assert.equal(calls.filter((url) => url.endsWith("/auth-cookie/refresh")).length, 1);
  await signOut();
  assert.equal(getCurrentAccount(), null);
});

test("logout clears private UI even when server is temporarily unavailable", async () => {
  globalThis.fetch = async (input) => String(input).endsWith("/auth-cookie/login")
    ? json({ user: { id: companyId, email: "fixture@example.test", role: "RECRUITER" } })
    : json({ code: "UNAVAILABLE" }, 503);
  await signIn("fixture@example.test", "fixture-password");
  await assert.rejects(signOut());
  assert.equal(getCurrentAccount(), null);
  assert.equal(getApiSessionAccountId(), null);
});

test("Job adapter preserves REMOTE, USD and authoritative aggregate version", async () => {
  const api = await import("./person2Api");
  globalThis.fetch = async () => json({ id: jobId, companyId, title: "Remote Engineer", jobType: "REMOTE", currency: "USD", aggregateVersion: 8, salaryMin: "2000", salaryMax: "4000", isNegotiable: false, description: "Description", location: "Remote", experienceYears: 3, quantity: 1, skills: ["Java"], deadline: "2027-12-31" });
  const result = await api.getPublicJob(jobId);
  assert.equal(result.data?.type, "REMOTE");
  assert.equal(result.data?.currency, "USD");
  assert.equal(result.data?.aggregateVersion, 8);
});

test("Company jobs use the backend company filter on every page and preserve totals", async () => {
  const api = await import("./person2Api");
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    urls.push(url);
    return json({ items: [], total: 7, page: Number(url.searchParams.get("page")), limit: 6, hasMore: url.searchParams.get("page") === "1", source: "POSTGRESQL", nextCursor: null });
  };
  for (const page of [1, 2]) {
    const result = await api.getPublicJobs({ companyId, mode: "OFFSET", page, limit: 6, sort: "NEWEST" });
    assert.equal(result.meta?.total, 7);
    assert.equal(result.meta?.hasMore, page === 1);
  }
  assert.equal(urls.length, 2);
  for (const [index, url] of urls.entries()) {
    assert.equal(url.pathname, "/jobs/search");
    assert.equal(url.searchParams.get("companyId"), companyId);
    assert.equal(url.searchParams.get("page"), String(index + 1));
    assert.equal(url.searchParams.get("sort"), "NEWEST");
    assert.equal(url.searchParams.has("q"), false);
  }
  await assert.rejects(api.getPublicJobs({ companyId: "invalid-company", mode: "OFFSET", sort: "NEWEST" }));
  assert.equal(urls.length, 2);
});

test("Company update sends captured version and preserves complete profile fields", async () => {
  const api = await import("./person2Api");
  globalThis.fetch = async (_input, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.expectedVersion, 3);
    assert.equal(body.description, "New description");
    return json({ id: companyId, name: "Company", taxCode: "0101234567", description: body.description, industry: "IT", size: "51-200", address: "Hà Nội", website: "https://example.test", aggregateVersion: 4, verifiedStatus: "PENDING" });
  };
  const result = await api.updateCompany(companyId, { expectedVersion: 3, description: "New description" });
  assert.equal(result.data.description, "New description");
  assert.equal(result.data.website, "https://example.test");
  assert.equal(result.data.aggregateVersion, 4);
});

test("Offer read maps real offer and application versions, terms and SENT status", async () => {
  const api = await import("./person2Api");
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), "http://gateway.test/offers/" + offerId);
    assert.equal(options?.cache, "no-store");
    return json({ id: offerId, applicationId, position: "Backend Engineer", salary: "30000000", version: 2, applicationVersion: 7, applicationStatus: "OFFER", status: "SENT", expiresAt: "2027-12-01T00:00:00Z", startDate: "2027-12-15", note: "Remote", responseNote: null, fileId: null, fileUrl: null });
  };
  const result = await api.getOffer(offerId);
  assert.equal(result.data?.offerVersion, 2);
  assert.equal(result.data?.applicationVersion, 7);
  assert.equal(result.data?.status, "PENDING_CANDIDATE_RESPONSE");
  assert.equal(result.data?.jobTitle, "Backend Engineer");
  assert.equal(result.data?.note, "Remote");
});

test("Application tracking retains timeline, cover letter and offer link", async () => {
  const api = await import("./person2Api");
  const timeline = [{ fromStatus: "INTERVIEW", toStatus: "OFFER", note: "Mời nhận việc", changedAt: "2026-09-10T01:00:00Z" }];
  globalThis.fetch = async () => json({ id: applicationId, jobId, companyId, jobTitle: "Backend Engineer", status: "OFFER", version: 7, appliedAt: "2026-09-01T00:00:00Z", timeline, coverLetter: "My letter", offerId });
  const result = await api.getApplicationDetail(applicationId);
  assert.deepEqual(result.data.timeline, timeline);
  assert.equal(result.data.coverLetter, "My letter");
  assert.equal(result.data.offerId, offerId);
});

test("empty candidate recommendations retain their root fallback reason", async () => {
  const api = await import("./person2Api");
  globalThis.fetch = async () => json({ items: [], source: "LATEST", fallbackReason: "NO_ACTIVE_CV", nextCursor: null });
  const result = await api.getRecommendationsForCandidate();
  assert.deepEqual(result.data, []);
  assert.equal(result.meta?.fallbackReason, "NO_ACTIVE_CV");
});

test("bookmark removal and CV picker use public Gateway paths with private caching", async () => {
  const api = await import("./person2Api");
  const seen: string[] = [];
  globalThis.fetch = async (input, options) => {
    seen.push(String(input));
    assert.equal(options?.cache, "no-store");
    return options?.method === "DELETE" ? new Response(null, { status: 204 }) : json([]);
  };
  await api.removeCandidateBookmark(jobId);
  await api.getActiveCandidateCvs();
  assert.deepEqual(seen, ["http://gateway.test/applications/bookmarks/" + jobId, "http://gateway.test/profile/cvs"]);
});

test("a private response body resolving after account switch is discarded", async () => {
  setApiSession({ token: "old-fixture", accountId: "old" });
  let release!: (value: unknown) => void;
  let decoding!: () => void;
  const started = new Promise<void>((resolve) => { decoding = resolve; });
  const response = json({});
  response.json = () => { decoding(); return new Promise((resolve) => { release = resolve; }); };
  const pending = requestApi("/applications/my", { privateData: true, fetcher: async () => response });
  await started;
  setApiSession({ token: "new-fixture", accountId: "new" });
  release({ data: ["private old data"], meta: null });
  await assert.rejects(pending, (error: unknown) => error instanceof ApiClientError && error.code === "REQUEST_CANCELLED");
  assert.equal(getApiSessionAccountId(), "new");
});

test("late failed refresh cannot clear a newly signed-in account", async () => {
  setApiSession({ token: "old-fixture", accountId: "old" });
  let release!: (value: null) => void;
  let refreshing!: () => void;
  const started = new Promise<void>((resolve) => { refreshing = resolve; });
  configureApiSessionRefresh(() => { refreshing(); return new Promise((resolve) => { release = resolve; }); });
  const pending = requestApi("/applications/my", { privateData: true, fetcher: async () => json({ code: "AUTH_INVALID" }, 401) });
  await started;
  setApiSession({ token: "new-fixture", accountId: "new" });
  release(null);
  await assert.rejects(pending, (error: unknown) => error instanceof ApiClientError && error.code === "REQUEST_CANCELLED");
  assert.equal(getApiSessionAccountId(), "new");
});

test("a new account gets its own refresh flight while the previous one is pending", async () => {
  setApiSession({ token: "old-fixture", accountId: "old" });
  let release!: (value: null) => void;
  let refreshing!: () => void;
  const started = new Promise<void>((resolve) => { refreshing = resolve; });
  configureApiSessionRefresh(() => { refreshing(); return new Promise((resolve) => { release = resolve; }); });
  const oldRequest = requestApi("/applications/my", { privateData: true, fetcher: async () => json({ code: "AUTH_INVALID" }, 401) });
  await started;
  setApiSession({ token: "new-expired-fixture", accountId: "new" });
  configureApiSessionRefresh(async () => ({ token: "new-refreshed-fixture", accountId: "new" }));
  let calls = 0;
  const current = await requestApi<string>("/applications/my", { privateData: true, fetcher: async () => ++calls === 1 ? json({ code: "AUTH_INVALID" }, 401) : json("new account") });
  assert.equal(current.data, "new account");
  release(null);
  await assert.rejects(oldRequest, (error: unknown) => error instanceof ApiClientError && error.code === "REQUEST_CANCELLED");
  assert.equal(getApiSessionAccountId(), "new");
});

test("public requests neither send a private bearer nor invalidate login on 401", async () => {
  setApiSession({ token: "private-fixture", accountId: "current" });
  await assert.rejects(requestApi("/jobs/search", { fetcher: async (_input, options) => {
    assert.equal(new Headers(options?.headers).get("authorization"), null);
    return json({ code: "AUTH_INVALID" }, 401);
  } }));
  assert.equal(getApiSessionAccountId(), "current");
});

test("caller cancellation during JSON decoding preserves the current session", async () => {
  setApiSession({ token: "fixture-token", accountId: "candidate" });
  const controller = new AbortController();
  let release!: (value: unknown) => void;
  let decoding!: () => void;
  const started = new Promise<void>((resolve) => { decoding = resolve; });
  const response = json({});
  response.json = () => { decoding(); return new Promise((resolve) => { release = resolve; }); };
  const pending = requestApi("/applications/my", { privateData: true, signal: controller.signal, fetcher: async () => response });
  await started;
  controller.abort();
  release({ data: [], meta: null });
  await assert.rejects(pending, (error: unknown) => error instanceof ApiClientError && error.code === "REQUEST_CANCELLED");
  assert.equal(getApiSessionAccountId(), "candidate");
});
