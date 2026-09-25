import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiClientError,
  assertCanonicalUuidV4,
  clearApiSession,
  configureApiSessionRefresh,
  buildQuery,
  collectionPath,
  createChatSessionId,
  getApiSessionAccountId,
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
import {
  buildApplicationStatusCommand,
  buildApplicationWithdrawCommand,
  buildMatchRefreshCommand,
  buildOfferResponseCommand,
  buildSendOfferCommand,
  nextApplicationVersion,
  nextOfferVersions,
} from "./applicationVersioning";
import { offerResponseRecoveryView } from "./offerResponseRecovery";
import { OFFER_ATTACHMENT_SUPPORT, emptyOfferAttachment, normalizeOfferAttachment } from "./offerAttachment";
import { candidateApplicationActions, recruiterApplicationActions, validateRecruiterApplicationStatus } from "./applicationStateMachine";
import { applicationCooldownView } from "./applicationCooldown";
import { activeJobsMetricView, bookmarkCardView, dashboardWarningView } from "./applicationDegradedStates";
import { AI_MATCH_POLL_DELAY_MS, aiMatchNotReadyView } from "./aiMatchRecovery";
import { isCvDownloadFresh, resolveFreshCvDownload } from "./recruiterCvAccess";
import { isEvaluationAlreadyExists, normalizeEvaluationDraft } from "./applicationEvaluation";
import { APPLICATION_API_ROUTES, applicationResourceRoute, offerResponseRoute, recruiterDashboardRoute } from "./applicationApiRoutes";
import { assertChatResponseSession } from "./aiChatSession";
import { appendAiChatExchange, createAiChatConversation } from "./aiChatConversation";
import { isAiChatSessionBusy, withAiChatSessionLock } from "./aiChatSessionLock";
import { classifyAiChatBackpressure, runAiChatWithBusyRetry } from "./aiChatBackpressure";
import { classifyAiChatFeatureState } from "./aiChatFeatureState";
import { normalizeAiChatMessage, validateAiChatMessage } from "./aiChatMessage";
import { normalizeAiChatAnswer, presentAiChatResponse } from "./aiChatResponse";
import { assertPerson2AiPublicRoute, PERSON2_AI_PUBLIC_ROUTES, recruiterCandidateRecommendationsRoute } from "./person2AiPublicRoutes";
import { APPLICATION_CONFLICT_FIELDS, JOB_CONFLICT_FIELDS, type ApplicationConflictDraft } from "./person2ConflictFields";
import type { CandidateApplication, Job } from "./demoData";
import { normalizeRecruiterApplicationQuery, shouldRestartOffsetApplications, validateRecruiterApplicationFilters, type RecruiterApplicationFilterDraft } from "./recruiterApplicationTable";
import {
  normalizeInvitationEmail,
  validateInvitationEmail,
} from "./companyInvitation";
import {
  invitationFailureView,
  validateInvitationToken,
} from "./companyInvitationAcceptance";
import {
  canManageCompanyAsOwner,
  roleAfterOwnershipTransfer,
  withoutRemovedMember,
} from "./companyMembership";
import { isRejectedRecruiterJob, nextRecruiterJobStatus, recruiterJobActionLabel, recruiterJobActions, recruiterJobEditLabel } from "./jobLifecycle";
import { jobEditRequiresReview, normalizeJobSkills, normalizeRecruiterJobForm, validateRecruiterJobForm, type RecruiterJobFormValues } from "./jobForm";
import { buildRecruiterJobTable, type RecruiterJobTableRow } from "./recruiterJobTable";
import { isRecruiterJobAccessDenied, recruiterJobScopeView } from "./recruiterJobAccess";
import { emptyPublicJobSearchForm, isOffsetWindowTooDeep, mergePublicJobPage, normalizePublicJobSearch, publicJobSearchScope, validatePublicJobSearch } from "./publicJobSearch";
import { cursorRestartView } from "./cursorRecovery";
import { canLoadMoreRecommendations, jobDataSourceView, mergeRecommendationPage, recommendationFallbackView, recommendationSourceView } from "./recommendationPresentation";
import { CANDIDATE_RECOMMENDATION_DEBOUNCE_MS, candidateRecommendationEmptyView, type CandidateRecommendationEmptyReason } from "./candidateRecommendation";
import {
  normalizeCompanyCreate,
  validateCompanyCreate,
} from "./companyForm";
import {
  createMediaIdempotencyKey,
  secondsUntilExpiry,
  validateCompanyMediaFile,
} from "./companyMediaUpload";
import {
  moveCompanyMediaItem,
  normalizeCompanyMediaLibrary,
  validateCompanyMediaLibrary,
} from "./companyMediaLibrary";
import { mergePublicCompanyPage, shouldLockCompanySearch } from "./companyPublicSearch";
import { companyLogoFallback, orderPublicCompanyMedia } from "./companyPublicProfile";
import {
  companyVerificationView,
  isInvalidResubmissionTransition,
  requiresCompanyReverification,
} from "./companyVerification";
import { createTransientRecoveryPlan } from "./transientRecovery";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://gateway.test";

test("collection paths always preserve the gateway trailing slash", () => {
  assert.equal(collectionPath("/applications"), "/applications/");
  assert.equal(collectionPath("/jobs/"), "/jobs/");
});

test("Application, bookmark and Offer paths preserve their three distinct gateway prefixes", () => {
  assert.deepEqual(APPLICATION_API_ROUTES, {
    collection: "/applications/",
    bookmarks: "/applications/bookmarks",
    offers: "/offers/",
  });
  assert.equal(applicationResourceRoute("application-id", "cv/download-url"), "/applications/application-id/cv/download-url");
  assert.equal(recruiterDashboardRoute(), "/applications/stats");
  assert.equal(offerResponseRoute("offer-id"), "/offers/offer-id/respond");
  assert.doesNotMatch(offerResponseRoute("offer-id"), /^\/applications\//);
});

test("canonical UUID v4 accepts lowercase only", () => {
  const uuid = "018f47a2-6f4d-4b7d-8c91-ff02d770a944";
  assert.equal(assertCanonicalUuidV4(uuid), uuid);
  assert.throws(
    () => assertCanonicalUuidV4(uuid.toUpperCase()),
    (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_UUID_V4",
  );
});

test("AI chat creates one canonical lowercase UUID v4 without a backend session endpoint", () => {
  const generated = createChatSessionId(() => "018F47A2-6F4D-4B7D-8C91-FF02D770A944");
  assert.equal(generated, "018f47a2-6f4d-4b7d-8c91-ff02d770a944");
  assert.equal(createChatSessionId(() => generated), generated);
});

test("AI chat rejects a response belonging to another in-memory session", () => {
  const expected = "018f47a2-6f4d-4b7d-8c91-ff02d770a944";
  assert.equal(assertChatResponseSession(expected, expected), expected);
  assert.throws(
    () => assertChatResponseSession(expected, "118f47a2-6f4d-4b7d-8c91-ff02d770a944"),
    (error: unknown) => error instanceof ApiClientError && error.code === "CHAT_SESSION_MISMATCH",
  );
});

test("AI chat conversation starts locally and appends exactly one request-response exchange", () => {
  const initial = createAiChatConversation();
  const next = appendAiChatExchange(initial, "Tìm việc Java", "Bạn có thể mở danh sách việc phù hợp.", "turn-1");
  assert.equal(initial.length, 1);
  assert.deepEqual(next.slice(1).map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "Tìm việc Java" },
    { role: "assistant", content: "Bạn có thể mở danh sách việc phù hợp." },
  ]);
});

test("AI chat reset rebuilds display state because the backend exposes no history read endpoint", () => {
  const first = createAiChatConversation();
  const changed = appendAiChatExchange(first, "Một câu hỏi", "Một câu trả lời", "turn-1");
  const reset = createAiChatConversation();
  assert.equal(changed.length, 3);
  assert.deepEqual(reset, first);
  assert.notEqual(reset, first);
});

test("AI chat permits only one in-flight request for each canonical session", async () => {
  const sessionId = "018f47a2-6f4d-4b7d-8c91-ff02d770a944";
  let release!: () => void;
  const first = withAiChatSessionLock(sessionId, () => new Promise<string>((resolve) => { release = () => resolve("done"); }));
  await assert.rejects(
    withAiChatSessionLock(sessionId, async () => "duplicate"),
    (error: unknown) => isAiChatSessionBusy(error),
  );
  release();
  assert.equal(await first, "done");
  assert.equal(await withAiChatSessionLock(sessionId, async () => "retry"), "retry");
});

test("AI chat recognizes only the exact 409 session-busy contract for manual retry", () => {
  assert.equal(isAiChatSessionBusy(new ApiClientError({ code: "CHAT_SESSION_BUSY", status: 409 })), true);
  assert.equal(isAiChatSessionBusy(new ApiClientError({ code: "CHAT_SESSION_BUSY", status: 503 })), false);
  assert.equal(isAiChatSessionBusy(new ApiClientError({ code: "APPLICATION_CHANGED_CONCURRENTLY", status: 409 })), false);
});

test("AI chat maps rate limit, short busy retry and provider/history manual recovery separately", () => {
  assert.deepEqual(
    classifyAiChatBackpressure(new ApiClientError({ code: "CHAT_RATE_LIMITED", status: 429, retryAfterSeconds: 12 })),
    { kind: "rate-limit", retryAfterSeconds: 12 },
  );
  assert.deepEqual(
    classifyAiChatBackpressure(new ApiClientError({ code: "CHAT_BUSY", status: 503, retryAfterSeconds: 4 })),
    { kind: "busy", retryAfterSeconds: 4, delayMs: 2_000 },
  );
  assert.deepEqual(
    classifyAiChatBackpressure(new ApiClientError({ code: "CHAT_PROVIDER_UNAVAILABLE", status: 503 })),
    { kind: "manual", code: "CHAT_PROVIDER_UNAVAILABLE" },
  );
  assert.deepEqual(
    classifyAiChatBackpressure(new ApiClientError({ code: "CHAT_HISTORY_UNAVAILABLE", status: 503 })),
    { kind: "manual", code: "CHAT_HISTORY_UNAVAILABLE" },
  );
});

test("AI chat retries exact CHAT_BUSY with Retry-After once and keeps the retry short", async () => {
  let calls = 0;
  const delays: number[] = [];
  const value = await runAiChatWithBusyRetry(async () => {
    calls += 1;
    if (calls === 1) throw new ApiClientError({ code: "CHAT_BUSY", status: 503, retryAfterSeconds: 1 });
    return "answer";
  }, async (delayMs) => { delays.push(delayMs); });
  assert.equal(value, "answer");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1_000]);
});

test("AI chat never auto-retries rate, provider or history failures", async () => {
  for (const error of [
    new ApiClientError({ code: "CHAT_RATE_LIMITED", status: 429, retryAfterSeconds: 9 }),
    new ApiClientError({ code: "CHAT_PROVIDER_UNAVAILABLE", status: 503 }),
    new ApiClientError({ code: "CHAT_HISTORY_UNAVAILABLE", status: 503 }),
  ]) {
    let calls = 0;
    await assert.rejects(runAiChatWithBusyRetry(async () => { calls += 1; throw error; }));
    assert.equal(calls, 1);
  }
});

test("AI chat feature states distinguish disabled, wrong role and exhausted authentication", () => {
  assert.equal(classifyAiChatFeatureState(new ApiClientError({ code: "CHAT_NOT_CONFIGURED", status: 503 })), "hidden");
  assert.equal(classifyAiChatFeatureState(new ApiClientError({ code: "CHAT_ACCESS_FORBIDDEN", status: 403 })), "forbidden");
  assert.equal(classifyAiChatFeatureState(new ApiClientError({ code: "AUTH_INVALID", status: 401 })), "reauthenticate");
  assert.equal(classifyAiChatFeatureState(new ApiClientError({ code: "CHAT_BUSY", status: 503 })), null);
});

test("private API refreshes the same account once and retries a rejected request with the new access token", async () => {
  setApiSession({ token: "expired-token", accountId: "candidate-refresh" });
  const revision = getApiSessionRevision();
  let refreshCalls = 0;
  const authorizations: Array<string | null> = [];
  configureApiSessionRefresh(async () => {
    refreshCalls += 1;
    return { token: "fresh-token", accountId: "candidate-refresh" };
  });
  let requests = 0;
  const response = await requestApi<{ answer: string }>("/ai/chat", {
    method: "POST",
    privateData: true,
    maxRetries: 0,
    body: { session_id: "018f47a2-6f4d-4b7d-8c91-ff02d770a944", message: "hello" },
    fetcher: async (_input, init) => {
      requests += 1;
      authorizations.push(new Headers(init?.headers).get("authorization"));
      return requests === 1
        ? new Response(JSON.stringify({ code: "AUTH_INVALID" }), { status: 401, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ data: { answer: "ok" }, meta: null }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(response.data.answer, "ok");
  assert.equal(refreshCalls, 1);
  assert.equal(requests, 2);
  assert.deepEqual(authorizations, ["Bearer expired-token", "Bearer fresh-token"]);
  assert.equal(getApiSessionRevision(), revision);
  configureApiSessionRefresh(null);
  clearApiSession();
});

test("private API never loops refresh and clears session after a second 401", async () => {
  setApiSession({ token: "expired-token", accountId: "candidate-refresh-fails" });
  let refreshCalls = 0;
  let requests = 0;
  configureApiSessionRefresh(async () => {
    refreshCalls += 1;
    return { token: "still-invalid", accountId: "candidate-refresh-fails" };
  });
  await assert.rejects(requestApi("/ai/chat", {
    method: "POST",
    privateData: true,
    maxRetries: 0,
    body: {},
    fetcher: async () => {
      requests += 1;
      return new Response(JSON.stringify({ code: "AUTH_INVALID" }), { status: 401, headers: { "content-type": "application/json" } });
    },
  }), (error: unknown) => error instanceof ApiClientError && error.status === 401);
  assert.equal(refreshCalls, 1);
  assert.equal(requests, 2);
  assert.equal(getApiSessionAccountId(), null);
  configureApiSessionRefresh(null);
});

test("AI chat normalizes NFC and trim while preserving supported tab and newline", () => {
  const validation = validateAiChatMessage("  To\u0302i\tcần việc\nJava  ");
  assert.equal(validation.value, "Tôi\tcần việc\nJava");
  assert.equal(validation.errorCode, null);
  assert.equal(normalizeAiChatMessage("  To\u0302i\tcần việc\nJava  "), "Tôi\tcần việc\nJava");
});

test("AI chat rejects blank text and forbidden C0/C1 control characters", () => {
  assert.equal(validateAiChatMessage(" \t\n ").errorCode, "CHAT_MESSAGE_REQUIRED");
  assert.equal(validateAiChatMessage("unsafe\u0000message").errorCode, "CHAT_MESSAGE_CONTROL_CHARACTER");
  assert.equal(validateAiChatMessage("unsafe\u0085message").errorCode, "CHAT_MESSAGE_CONTROL_CHARACTER");
});

test("AI chat enforces 2000 Unicode code points instead of UTF-16 length", () => {
  const exact = validateAiChatMessage("😀".repeat(2_000));
  assert.equal(exact.characterCount, 2_000);
  assert.equal(exact.byteCount, 8_000);
  assert.equal(exact.errorCode, null);
  assert.equal(validateAiChatMessage("a".repeat(2_001)).errorCode, "CHAT_MESSAGE_TOO_LONG");
});

test("AI chat rejects the UTF-8 byte limit before the character-count constraint", () => {
  const oversized = validateAiChatMessage("😀".repeat(2_001));
  assert.equal(oversized.characterCount, 2_001);
  assert.equal(oversized.byteCount, 8_004);
  assert.equal(oversized.errorCode, "CHAT_MESSAGE_TOO_MANY_BYTES");
  assert.throws(() => normalizeAiChatMessage("😀".repeat(2_001)), (error: unknown) => error instanceof ApiClientError && error.status === 422);
});

test("AI chat keeps model HTML and markdown-like content as literal text", () => {
  const raw = "Không mở <script>evil()</script> hay [link](https://evil.invalid).";
  const presentation = presentAiChatResponse(raw);
  assert.equal(presentation.text, raw);
  assert.equal(presentation.jobLines.length, 0);
  assert.equal(presentation.hasSuitableJobsIntent, false);
});

test("AI chat recognizes only deterministic numbered Job lines and exposes UUID as plain text", () => {
  const answer = [
    "Mình tìm thấy các gợi ý việc làm hiện tại cho bạn:",
    "1. Backend Engineer — CareerHub — Hà Nội; Toàn thời gian; Lương thỏa thuận; mã việc 30000000-0000-4000-8000-000000000001",
    "2. AI Engineer — CareerHub — Remote; Toàn thời gian; 20–30 VND; mã việc 30000000-0000-4000-8000-000000000002",
    "Hãy mở màn “Việc làm phù hợp” để xem chi tiết và trạng thái mới nhất.",
  ].join("\n");
  const presentation = presentAiChatResponse(answer);
  assert.equal(presentation.jobLines.length, 2);
  assert.equal(presentation.jobLines[0].jobId, "30000000-0000-4000-8000-000000000001");
  assert.match(presentation.jobLines[0].text, /mã việc 30000000/);
  assert.doesNotMatch(presentation.jobLines[0].text, /href|https?:/i);
  assert.equal(presentation.hasSuitableJobsIntent, true);
});

test("AI chat rejects unsafe or unbounded response bodies before rendering", () => {
  assert.throws(() => normalizeAiChatAnswer("   "), (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_API_RESPONSE");
  assert.throws(() => normalizeAiChatAnswer("unsafe\u0000answer"), (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_API_RESPONSE");
  assert.throws(() => normalizeAiChatAnswer("x".repeat(8_001)), (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_API_RESPONSE");
});

test("Person 2 AI consumers route only through chat and public Job recommendation APIs", () => {
  assert.equal(PERSON2_AI_PUBLIC_ROUTES.chat, "/ai/chat");
  assert.equal(PERSON2_AI_PUBLIC_ROUTES.candidateJobRecommendations, "/jobs/recommended");
  assert.equal(
    recruiterCandidateRecommendationsRoute("018f47a2-6f4d-4b7d-8c91-ff02d770a944"),
    "/jobs/018f47a2-6f4d-4b7d-8c91-ff02d770a944/recommended-candidates",
  );
});

test("Person 2 FE rejects every internal AI provider route variant", () => {
  for (const path of [
    "/ai/match",
    "/ai/match/",
    "/ai/recommend/jobs",
    "/ai/recommend/jobs?limit=3",
    "/ai/recommend/candidates",
    "/ai/recommend/candidates#private",
  ]) {
    assert.throws(
      () => assertPerson2AiPublicRoute(path),
      (error: unknown) => error instanceof ApiClientError && error.code === "AI_PUBLIC_ROUTE_REQUIRED",
    );
  }
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

test("service rate-limit body uses the same Retry-After recovery contract", async () => {
  await assert.rejects(
    requestApi("/jobs/018f47a2-6f4d-4b7d-8c91-ff02d770a944/recommended-candidates", {
      maxRetries: 0,
      fetcher: async () => new Response(JSON.stringify({
        code: "RECOMMENDATION_RATE_LIMITED",
        message: "service internal details",
        details: { retryAfterSeconds: 60 },
      }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "RECOMMENDATION_RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 60);
      assert.equal(error.recovery, "retry-after");
      assert.doesNotMatch(error.message, /service|internal/i);
      return true;
    },
  );
});

test("candidate recommendation refresh uses the shared 300ms debounce window", () => {
  assert.equal(CANDIDATE_RECOMMENDATION_DEBOUNCE_MS, 300);
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

test("Job conflict snapshot compares the retained form against one authoritative reload", async () => {
  let reloads = 0;
  const localDraft = { currency: "USD", title: "Backend mới", location: "Hà Nội", jobType: "FULL_TIME", deadline: "2026-12-31", isNegotiable: true, salaryMin: "", salaryMax: "", experienceYears: "3", quantity: "2", skills: "Java, Kafka", description: "Mô tả mới", requirements: "Java", benefits: "Bảo hiểm" } as const;
  const server = { currency: "USD", title: "Backend cũ", location: "Hà Nội", type: "FULLTIME", deadline: "2026-12-31T00:00:00Z", isNegotiable: true, salaryMin: 0, salaryMax: null, skills: ["Java"], description: "Mô tả cũ", aggregateVersion: 8 } as unknown as Job;
  const snapshot = await prepareConflictSnapshot({
    error: new ApiClientError({ code: "JOB_STATE_CHANGED", status: 409 }),
    localDraft: { ...localDraft },
    localVersion: 7,
    reload: async () => { reloads += 1; return server; },
    serverVersion: (value) => value.aggregateVersion,
    fields: JOB_CONFLICT_FIELDS,
  });
  assert.equal(reloads, 1);
  assert.equal(snapshot.serverVersion, 8);
  assert.equal(snapshot.fields.find((field) => field.key === "title")?.changed, true);
  assert.equal(snapshot.fields.find((field) => field.key === "location")?.changed, false);
});

test("Application conflict snapshot retains intent and expected version without replaying it", async () => {
  const localDraft: ApplicationConflictDraft = { intent: "Chuyển hồ sơ sang INTERVIEW", targetStatus: "INTERVIEW", note: "", applicationVersion: 4 };
  const server = { id: "app-1", status: "REVIEWING", version: 5 } as CandidateApplication;
  const snapshot = await prepareConflictSnapshot({
    error: new ApiClientError({ code: "APPLICATION_CHANGED_CONCURRENTLY", status: 409 }),
    localDraft,
    localVersion: 4,
    reload: async () => server,
    serverVersion: (value) => value.version,
    fields: APPLICATION_CONFLICT_FIELDS,
  });
  assert.equal(snapshot.localDraft.intent, "Chuyển hồ sơ sang INTERVIEW");
  assert.equal(snapshot.server.status, "REVIEWING");
  assert.equal(snapshot.serverVersion, 5);
  assert.equal(snapshot.fields.find((field) => field.key === "version")?.changed, true);
});

test("every Application write command carries its latest expected version", () => {
  assert.equal(buildApplicationStatusCommand({ status: "REVIEWING", applicationVersion: 4 }).expectedVersion, 4);
  assert.equal(buildApplicationWithdrawCommand({ applicationVersion: 5 }).expectedVersion, 5);
  assert.equal(buildMatchRefreshCommand(6).expectedVersion, 6);
  assert.equal(buildSendOfferCommand({ salary: 25_000_000, startDate: "2026-10-01", position: "Engineer", expiresAt: "2026-09-30T00:00:00Z", applicationVersion: 7 }).expectedApplicationVersion, 7);
  assert.deepEqual(buildOfferResponseCommand({ decision: "ACCEPTED", offerVersion: 2, applicationVersion: 8 }), {
    decision: "ACCEPTED",
    declineReason: undefined,
    expectedOfferVersion: 2,
    expectedApplicationVersion: 8,
  });
});

test("Offer attachment is either one confirmed pair or fully absent", () => {
  const fileId = "018f47a2-6f4d-4b7d-8c91-ff02d770a944";
  assert.deepEqual(normalizeOfferAttachment({ fileId, fileUrl: "https://media.test/offer.pdf" }), {
    fileId,
    fileUrl: "https://media.test/offer.pdf",
  });
  assert.equal(normalizeOfferAttachment(emptyOfferAttachment()), null);
  assert.throws(
    () => normalizeOfferAttachment({ fileId }),
    (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_OFFER_FILE_PAIR",
  );
  assert.throws(
    () => normalizeOfferAttachment({ fileId, fileUrl: "file:///tmp/offer.pdf" }),
    (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_OFFER_FILE_URL",
  );
  assert.equal(OFFER_ATTACHMENT_SUPPORT.available, false);
  assert.match(OFFER_ATTACHMENT_SUPPORT.description, /OFFER_LETTER/);
});

test("mutation responses become the only source for the next command versions", () => {
  assert.equal(nextApplicationVersion({ version: 9 }), 9);
  assert.deepEqual(nextOfferVersions({ version: 3, applicationVersion: 10 }), { offerVersion: 3, applicationVersion: 10 });
  assert.throws(
    () => buildMatchRefreshCommand(-1),
    (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_EXPECTED_VERSION",
  );
  assert.throws(
    () => nextApplicationVersion({ version: Number.NaN }),
    (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_EXPECTED_VERSION",
  );
});

test("the four Offer 409 outcomes expose distinct recovery messages and actions", () => {
  const codes = [
    "OFFER_EXPIRED",
    "OFFER_ALREADY_RESPONDED",
    "OFFER_CHANGED_CONCURRENTLY",
    "APPLICATION_CHANGED_CONCURRENTLY",
  ];
  const views = codes.map((code) => offerResponseRecoveryView(new ApiClientError({ code, status: 409 })));

  assert.equal(views.every(Boolean), true);
  assert.equal(new Set(views.map((view) => view?.title)).size, 4);
  assert.equal(new Set(views.map((view) => view?.action.label)).size, 4);
  assert.equal(offerResponseRecoveryView(new ApiClientError({ code: "OFFER_EXPIRED", status: 400 })), null);
  assert.equal(offerResponseRecoveryView(new ApiClientError({ code: "UNKNOWN", status: 409 })), null);
});

test("Application state machine exposes only backend-valid recruiter commands", () => {
  assert.deepEqual(recruiterApplicationActions("APPLIED").filter((action) => action.kind === "STATUS").map((action) => action.status), ["REVIEWING", "REJECTED"]);
  assert.deepEqual(recruiterApplicationActions("REVIEWING").filter((action) => action.kind === "STATUS").map((action) => action.status), ["INTERVIEW", "REJECTED"]);
  assert.equal(recruiterApplicationActions("INTERVIEW").some((action) => action.kind === "SEND_OFFER"), true);
  assert.deepEqual(recruiterApplicationActions("INTERVIEW").filter((action) => action.kind === "STATUS").map((action) => action.status), ["REJECTED"]);
  assert.deepEqual(recruiterApplicationActions("HIRED"), []);
  assert.deepEqual(recruiterApplicationActions("WITHDRAWN"), []);
});

test("candidate actions withdraw only active applications and route OFFER decisions separately", () => {
  for (const status of ["APPLIED", "REVIEWING", "INTERVIEW", "OFFER"] as const) {
    assert.equal(candidateApplicationActions(status).some((action) => action.kind === "WITHDRAW"), true);
  }
  assert.equal(candidateApplicationActions("OFFER").some((action) => action.kind === "RESPOND_OFFER"), true);
  assert.deepEqual(candidateApplicationActions("HIRED"), []);
  assert.deepEqual(candidateApplicationActions("REJECTED"), []);
});

test("Application rejection requires a reason and invalid transitions fail before request", () => {
  assert.match(validateRecruiterApplicationStatus("APPLIED", "REJECTED", "") ?? "", /lý do/);
  assert.equal(validateRecruiterApplicationStatus("APPLIED", "REJECTED", "Không phù hợp"), null);
  assert.match(validateRecruiterApplicationStatus("APPLIED", "INTERVIEW") ?? "", /không hợp lệ/);
});

test("reapplication cooldown renders the backend eligibleAt as a concrete Vietnamese time", () => {
  const view = applicationCooldownView(new ApiClientError({
    code: "REAPPLICATION_COOLDOWN",
    status: 409,
    details: { eligibleAt: "2026-10-01T02:30:00Z" },
  }));

  assert.equal(view?.eligibleAt, "2026-10-01T02:30:00Z");
  assert.match(view?.eligibleAtLabel ?? "", /2026/);
  assert.match(view?.description ?? "", /30 ngày/);
  assert.equal(applicationCooldownView(new ApiClientError({ code: "REAPPLICATION_COOLDOWN", status: 409 })), null);
  assert.equal(applicationCooldownView(new ApiClientError({ code: "APPLICATION_CHANGED_CONCURRENTLY", status: 409, details: { eligibleAt: "2026-10-01T02:30:00Z" } })), null);
});

test("recruiter Application filters validate date order and normalize the exact query", () => {
  const draft: RecruiterApplicationFilterDraft = { status: "REVIEWING", appliedFrom: "2026-08-01", appliedTo: "2026-08-31", skills: "React, Java, React", sort: "MATCH_SCORE_DESC", size: 100 };
  assert.equal(validateRecruiterApplicationFilters(draft), null);
  assert.deepEqual(normalizeRecruiterApplicationQuery("job-id", draft, 2), {
    jobId: "job-id",
    status: "REVIEWING",
    appliedFrom: "2026-08-01T00:00:00.000Z",
    appliedTo: "2026-08-31T23:59:59.999Z",
    skills: ["React", "Java"],
    sort: "MATCH_SCORE_DESC",
    page: 2,
    size: 100,
  });
  assert.match(validateRecruiterApplicationFilters({ ...draft, appliedFrom: "2026-09-01" }) ?? "", /trước hoặc bằng/);
  assert.match(validateRecruiterApplicationFilters({ ...draft, size: 101 }) ?? "", /1 đến 100/);
});

test("offset Application pages restart when totals move or records overlap", () => {
  assert.equal(shouldRestartOffsetApplications({ page: 1, expectedTotal: 40, actualTotal: 41, seenIds: new Set(), currentIds: ["c"] }), true);
  assert.equal(shouldRestartOffsetApplications({ page: 1, expectedTotal: 40, actualTotal: 40, seenIds: new Set(["a", "b"]), currentIds: ["b", "c"] }), true);
  assert.equal(shouldRestartOffsetApplications({ page: 1, expectedTotal: 40, actualTotal: 40, seenIds: new Set(["a", "b"]), currentIds: ["c", "d"] }), false);
  assert.equal(shouldRestartOffsetApplications({ page: 0, expectedTotal: 40, actualTotal: 41, seenIds: new Set(["a"]), currentIds: ["a"] }), false);
});

test("bookmark degradation keeps the saved record and replaces only missing Job detail", () => {
  const degraded = bookmarkCardView({ jobId: "job-123", job: null });
  assert.equal(degraded.available, false);
  assert.match(degraded.description, /job-123/);
  assert.match(degraded.description, /vẫn được giữ/);

  const available = bookmarkCardView({ jobId: "job-123", job: { title: "Backend Engineer", exists: true } });
  assert.equal(available.available, true);
  assert.equal(available.title, "Backend Engineer");
});

test("dashboard degradation preserves Application metrics and masks unavailable active Jobs", () => {
  assert.deepEqual(activeJobsMetricView({ count: null, available: false }), {
    value: "—",
    detail: "Job Service đang gián đoạn; các số liệu Application khác vẫn chính xác.",
    degraded: true,
  });
  assert.equal(activeJobsMetricView({ count: 7, available: true }).value, "7");
  assert.match(dashboardWarningView("JOB_SERVICE_UNAVAILABLE"), /thống kê hồ sơ/);
  assert.doesNotMatch(dashboardWarningView("UNKNOWN_DOWNSTREAM"), /UNKNOWN_DOWNSTREAM/);
});

test("AI match not-ready is pollable business readiness, never an optimistic conflict", () => {
  const reasons = [
    "CV_EMBEDDING_NOT_FOUND",
    "JOB_EMBEDDING_NOT_FOUND",
    "CV_AND_JOB_EMBEDDINGS_NOT_FOUND",
    "EMBEDDING_MODEL_MISMATCH",
  ];
  const views = reasons.map((reason) => aiMatchNotReadyView(new ApiClientError({
    code: "AI_MATCH_NOT_READY",
    status: 409,
    details: { reason },
  })));
  assert.ok(views.every((view) => view?.message && view.pollDelayMs === AI_MATCH_POLL_DELAY_MS));
  assert.equal(new Set(views.map((view) => view?.message)).size, reasons.length);
  assert.equal(aiMatchNotReadyView(new ApiClientError({ code: "APPLICATION_CHANGED_CONCURRENTLY", status: 409 })), null);
  assert.equal(aiMatchNotReadyView(new ApiClientError({ code: "AI_MATCH_NOT_READY", status: 503 })), null);
});

test("recruiter CV links must be HTTPS and remain fresh beyond the navigation guard", () => {
  const now = Date.parse("2026-08-31T00:00:00Z");
  const base = { cvId: "cv-1", url: "https://media.test/cv.pdf", expiresAt: "2026-08-31T00:00:02Z" };
  assert.equal(isCvDownloadFresh(base, now), true);
  assert.equal(isCvDownloadFresh({ ...base, expiresAt: "2026-08-31T00:00:01Z" }, now), false);
  assert.equal(isCvDownloadFresh({ ...base, url: "http://media.test/cv.pdf" }, now), false);
  assert.equal(isCvDownloadFresh({ ...base, expiresAt: "invalid" }, now), false);
});

test("expired recruiter CV links are refreshed exactly once and never cached", async () => {
  const now = Date.parse("2026-08-31T00:00:00Z");
  let calls = 0;
  const download = await resolveFreshCvDownload(async () => {
    calls += 1;
    return {
      cvId: "cv-1",
      url: "https://media.test/cv.pdf",
      expiresAt: calls === 1 ? "2026-08-31T00:00:00Z" : "2026-08-31T00:05:00Z",
    };
  }, () => now);
  assert.equal(calls, 2);
  assert.equal(download.expiresAt, "2026-08-31T00:05:00Z");

  await assert.rejects(
    resolveFreshCvDownload(async () => ({ cvId: "cv-1", url: "https://media.test/cv.pdf", expiresAt: "2026-08-31T00:00:00Z" }), () => now),
    (error: unknown) => error instanceof ApiClientError && error.code === "CV_DOWNLOAD_EXPIRED",
  );
});

test("evaluation form mirrors backend score precision, criteria and note rules", () => {
  assert.deepEqual(normalizeEvaluationDraft({
    score: "85.50",
    technical: "90",
    communication: "80.25",
    culture: "75",
    note: "  Ứng viên phù hợp  ",
  }), {
    score: 85.5,
    criteria: { technical: 90, communication: 80.25, culture: 75 },
    note: "Ứng viên phù hợp",
  });
  assert.throws(
    () => normalizeEvaluationDraft({ score: "100.001", technical: "90", communication: "80", culture: "75", note: "" }),
    (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_EVALUATION_SCORE",
  );
});

test("only exact evaluation duplicate 409 becomes remembered evaluated state", () => {
  assert.equal(isEvaluationAlreadyExists(new ApiClientError({ code: "EVALUATION_ALREADY_EXISTS", status: 409 })), true);
  assert.equal(isEvaluationAlreadyExists(new ApiClientError({ code: "APPLICATION_CHANGED_CONCURRENTLY", status: 409 })), false);
  assert.equal(isEvaluationAlreadyExists(new ApiClientError({ code: "EVALUATION_ALREADY_EXISTS", status: 503 })), false);
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

test("company onboarding validates every required backend field", () => {
  const errors = validateCompanyCreate({
    name: "A",
    description: "",
    industry: "",
    size: "",
    address: "",
    website: "ftp://example.vn",
    taxCode: "",
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    "address", "description", "industry", "name", "size", "taxCode", "website",
  ]);
});

test("company onboarding accepts http website and trims the request body", () => {
  const values = {
    name: "  Công ty Mới  ",
    description: "  Nền tảng tuyển dụng  ",
    industry: "  Công nghệ  ",
    size: "  51-200  ",
    address: "  Hà Nội  ",
    website: "  https://example.vn  ",
    taxCode: "  0101234567  ",
  };
  assert.deepEqual(validateCompanyCreate(values), {});
  assert.deepEqual(normalizeCompanyCreate(values), {
    name: "Công ty Mới",
    description: "Nền tảng tuyển dụng",
    industry: "Công nghệ",
    size: "51-200",
    address: "Hà Nội",
    website: "https://example.vn",
    taxCode: "0101234567",
  });
});

test("company onboarding omits an empty optional website", () => {
  const normalized = normalizeCompanyCreate({
    name: "Công ty Mới",
    description: "Mô tả",
    industry: "Công nghệ",
    size: "10",
    address: "Hà Nội",
    website: "  ",
    taxCode: "0101",
  });
  assert.equal(normalized.website, undefined);
});

test("company verification exposes resubmission only for REJECTED", () => {
  const statuses = ["DRAFT", "PENDING", "VERIFIED", "REJECTED"] as const;
  const views = statuses.map((status) => companyVerificationView(status, " Thiếu giấy phép "));

  assert.deepEqual(views.map((view) => view.canResubmit), [false, false, false, true]);
  assert.deepEqual(views.map((view) => view.rejectReason), [null, null, null, "Thiếu giấy phép"]);
});

test("company verification does not leak a stale reject reason outside REJECTED", () => {
  const pending = companyVerificationView("PENDING", "Lý do cũ");
  assert.equal(pending.rejectReason, null);
  assert.match(pending.description, /chờ Admin/i);
});

test("resubmission conflict is recognized by exact code and status", () => {
  assert.equal(isInvalidResubmissionTransition(new ApiClientError({
    code: "INVALID_RESUBMISSION_TRANSITION",
    status: 409,
  })), true);
  assert.equal(isInvalidResubmissionTransition(new ApiClientError({
    code: "COMPANY_UPDATE_CONFLICT",
    status: 409,
  })), false);
  assert.equal(isInvalidResubmissionTransition(new ApiClientError({
    code: "INVALID_RESUBMISSION_TRANSITION",
    status: 400,
  })), false);
});

test("verified legal identity changes require explicit reverification warning", () => {
  const company = {
    verificationStatus: "VERIFIED" as const,
    name: "Công ty A",
    taxCode: "0101",
  };

  assert.equal(requiresCompanyReverification(company, {
    name: "Công ty B",
    taxCode: "0101",
  }), true);
  assert.equal(requiresCompanyReverification(company, {
    name: "  Công ty A ",
    taxCode: "0101",
  }), false);
  assert.equal(requiresCompanyReverification({
    ...company,
    verificationStatus: "REJECTED",
  }, { name: "Công ty B", taxCode: "0202" }), false);
});

test("company media validates format and size before consuming an upload intent", () => {
  assert.equal(validateCompanyMediaFile({ name: "logo.png", size: 1024 }, "COMPANY_LOGO"), null);
  assert.match(
    validateCompanyMediaFile({ name: "logo.svg", size: 1024 }, "COMPANY_LOGO") ?? "",
    /jpg, jpeg, png, webp/,
  );
  assert.match(
    validateCompanyMediaFile({ name: "clip.mp4", size: 51 * 1024 * 1024 }, "COMPANY_VIDEO") ?? "",
    /50 MB/,
  );
});

test("company media enforces the signed capability and expiry countdown", () => {
  const now = Date.UTC(2026, 7, 30, 10, 0, 0);
  const capability = {
    allowedFormats: ["png"],
    maxBytes: 2_000,
    expiresAt: new Date(now + 5_500).toISOString(),
  };
  assert.equal(secondsUntilExpiry(capability.expiresAt, now), 6);
  assert.equal(validateCompanyMediaFile({ name: "logo.png", size: 1_000 }, "COMPANY_LOGO", capability, now), null);
  assert.match(
    validateCompanyMediaFile({ name: "logo.png", size: 1_000 }, "COMPANY_LOGO", capability, now + 6_000) ?? "",
    /hết hạn/,
  );
});

test("company media idempotency key is stable, safe and long enough", () => {
  const key = createMediaIdempotencyKey(() => "018f47a2-6f4d-4b7d-8c91-ff02d770a944");
  assert.equal(key, "company-media-018f47a2-6f4d-4b7d-8c91-ff02d770a944");
  assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
});

test("company media library enforces replace-all quotas and unique file ids", () => {
  const item = (fileId: string, type: "IMAGE" | "VIDEO") => ({ fileId, type, url: "https://media.test/x", sortOrder: 0 });
  assert.match(validateCompanyMediaLibrary(undefined, Array.from({ length: 11 }, (_, index) => item(`i-${index}`, "IMAGE"))) ?? "", /10 ảnh/);
  assert.match(validateCompanyMediaLibrary(undefined, [item("v1", "VIDEO"), item("v2", "VIDEO")]) ?? "", /1 video/);
  assert.match(validateCompanyMediaLibrary("same", [item("same", "IMAGE")]) ?? "", /một lần/);
  assert.equal(validateCompanyMediaLibrary("logo", [item("image", "IMAGE"), item("video", "VIDEO")]), null);
});

test("company media library reorder always rewrites contiguous sortOrder", () => {
  const original = [
    { fileId: "a", type: "IMAGE" as const, url: "a", sortOrder: 7 },
    { fileId: "b", type: "IMAGE" as const, url: "b", sortOrder: 9 },
    { fileId: "c", type: "VIDEO" as const, url: "c", sortOrder: 12 },
  ];
  assert.deepEqual(
    moveCompanyMediaItem(original, "c", 0).map(({ fileId, sortOrder }) => ({ fileId, sortOrder })),
    [{ fileId: "c", sortOrder: 0 }, { fileId: "a", sortOrder: 1 }, { fileId: "b", sortOrder: 2 }],
  );
  assert.deepEqual(normalizeCompanyMediaLibrary(original).map((item) => item.sortOrder), [0, 1, 2]);
});

test("public company cursor pages append without exposing duplicates", () => {
  const company = (id: string) => ({
    id, name: id, slug: id, industry: "Tech", size: "10", address: "HN", logoUrl: null,
  });
  assert.deepEqual(
    mergePublicCompanyPage([company("a"), company("b")], [company("b"), company("c")], true).map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    mergePublicCompanyPage([company("a")], [company("z")], false).map((item) => item.id),
    ["z"],
  );
});

test("public company criteria stay locked for the entire cursor chain", () => {
  assert.equal(shouldLockCompanySearch(true, null), true);
  assert.equal(shouldLockCompanySearch(false, "opaque.signed-cursor"), true);
  assert.equal(shouldLockCompanySearch(false, null), false);
});

test("public company detail has a stable logo placeholder", () => {
  assert.equal(companyLogoFallback("  Đường Việt"), "Đ");
  assert.equal(companyLogoFallback(""), "DN");
});

test("public company detail renders only usable media in backend order", () => {
  const ordered = orderPublicCompanyMedia([
    { url: "https://cdn.test/second.jpg", type: "IMAGE", sortOrder: 2 },
    { url: " ", type: "IMAGE", sortOrder: 0 },
    { url: "https://cdn.test/first.mp4", type: "VIDEO", sortOrder: 1 },
  ]);
  assert.deepEqual(
    ordered.map((item) => [item.type, item.sortOrder]),
    [
      ["VIDEO", 1],
      ["IMAGE", 2],
    ],
  );
});

test("company invitation normalizes the exact email sent to the backend", () => {
  assert.equal(normalizeInvitationEmail("  MEMBER@Example.COM  "), "member@example.com");
  assert.equal(normalizeInvitationEmail(" me\u0301mber@example.com "), "mémber@example.com");
});

test("company invitation blocks missing, malformed and oversized emails", () => {
  assert.equal(validateInvitationEmail(""), "Nhập email người được mời.");
  assert.equal(validateInvitationEmail("member-at-example.com"), "Email chưa đúng định dạng.");
  assert.equal(
    validateInvitationEmail(`${"a".repeat(310)}@example.com`),
    "Email không được vượt quá 320 ký tự.",
  );
  assert.equal(validateInvitationEmail("member@example.com"), null);
});

test("invitation acceptance validates tokens without persisting them", () => {
  assert.equal(validateInvitationToken(""), "Nhập token lời mời.");
  assert.equal(validateInvitationToken("short"), "Token phải có ít nhất 32 ký tự.");
  assert.equal(validateInvitationToken("x".repeat(129)), "Token không được vượt quá 128 ký tự.");
  assert.equal(validateInvitationToken(`  ${"x".repeat(32)}  `), null);
});

test("invitation acceptance maps every business failure to a distinct recovery CTA", () => {
  const view = (code: string, status: number, details: Record<string, unknown> = {}) =>
    invitationFailureView({ code, status, details });

  assert.deepEqual(
    [view("INVITATION_NOT_FOUND", 404).title, view("INVITATION_NOT_FOUND", 404).actionLabel],
    ["Không tìm thấy lời mời", "Kiểm tra token khác"],
  );
  assert.equal(view("INVITATION_EXPIRED", 410).actionLabel, "Nhập token được phát lại");
  assert.equal(view("INVITATION_REISSUE_REQUIRED", 409).actionLabel, "Nhập token mới");
  assert.match(
    view("INVITATION_NOT_ACTIVE", 409, { status: "REVOKED" }).description,
    /REVOKED/,
  );
  assert.deepEqual(
    [view("RECRUITER_ALREADY_HAS_COMPANY", 409).action, view("RECRUITER_ALREADY_HAS_COMPANY", 409).actionLabel],
    ["OPEN_COMPANY", "Mở hồ sơ công ty"],
  );
  assert.equal(view("INVITATION_EMAIL_MISMATCH", 403).actionLabel, "Dùng token cho tài khoản này");
  assert.equal(view("AUTH_ACCOUNT_INACTIVE", 403).actionLabel, "Kiểm tra bằng tài khoản khác");
  assert.equal(view("AUTH_ACCOUNT_INVALID", 401).actionLabel, "Thử lại sau khi đăng nhập");
});

test("invitation acceptance keeps unknown failures retryable", () => {
  assert.deepEqual(invitationFailureView({
    code: "NETWORK_ERROR",
    status: 0,
    details: {},
  }), {
    title: "Chưa nhận được lời mời",
    description: "Kết nối có thể đang gián đoạn. Token vẫn được giữ trên màn hình này.",
    action: "RETRY",
    actionLabel: "Thử lại",
  });
});


test("session exposes only the in-memory account id needed for self membership lookup", () => {
  setApiSession({ token: "membership-token", accountId: "recruiter-membership" });
  assert.equal(getApiSessionAccountId(), "recruiter-membership");
  clearApiSession();
  assert.equal(getApiSessionAccountId(), null);
});

test("owner actions fail closed and disappear immediately after ownership transfer", () => {
  assert.equal(canManageCompanyAsOwner(null), false);
  assert.equal(canManageCompanyAsOwner("MEMBER"), false);
  assert.equal(canManageCompanyAsOwner("OWNER"), true);
  assert.equal(roleAfterOwnershipTransfer("OWNER"), "MEMBER");
});

test("removed members are deleted from the local authoritative list", () => {
  const members = [{ userId: "owner" }, { userId: "member" }];
  assert.deepEqual(withoutRemovedMember(members, "member"), [{ userId: "owner" }]);
  assert.deepEqual(withoutRemovedMember(members, "unknown"), members);
});


test("recruiter Job actions are derived only from the backend status", () => {
  assert.deepEqual(recruiterJobActions("DRAFT"), ["SUBMIT_FOR_APPROVAL"]);
  assert.deepEqual(recruiterJobActions("PENDING_APPROVAL"), []);
  assert.deepEqual(recruiterJobActions("PUBLISHED"), ["CLOSE"]);
  assert.deepEqual(recruiterJobActions("CLOSED"), []);
  assert.deepEqual(recruiterJobActions("EXPIRED"), []);
});

test("recruiter Job action copy and target status match backend semantics", () => {
  assert.equal(recruiterJobActionLabel("SUBMIT_FOR_APPROVAL"), "Gửi admin duyệt");
  assert.equal(nextRecruiterJobStatus("SUBMIT_FOR_APPROVAL"), "PENDING_APPROVAL");
  assert.equal(recruiterJobActionLabel("CLOSE"), "Đóng tin");
  assert.equal(nextRecruiterJobStatus("CLOSE"), "CLOSED");
});

test("rejected recruiter Jobs expose review feedback and a specific edit action", () => {
  assert.equal(isRejectedRecruiterJob("DRAFT", "Bổ sung mô tả"), true);
  assert.equal(isRejectedRecruiterJob("DRAFT", "  "), false);
  assert.equal(isRejectedRecruiterJob("PENDING_APPROVAL", "Góp ý cũ"), false);
  assert.equal(recruiterJobEditLabel("DRAFT", "Bổ sung mô tả"), "Sửa theo góp ý");
  assert.equal(recruiterJobEditLabel("DRAFT"), "Sửa tin");
});

test("recruiter Job table filters, sorts and paginates without mutating the full response", () => {
  const rows: RecruiterJobTableRow[] = [
    { id: "3", title: "Backend Engineer", status: "PUBLISHED", location: "Hà Nội", department: "Engineering", ownerName: "An", deadline: "2026-10-20", updatedAt: "2026-08-01" },
    { id: "1", title: "Account Executive", status: "DRAFT", location: "Đà Nẵng", department: "Sales", ownerName: "Bình", deadline: "2026-09-10", updatedAt: "2026-08-20" },
    { id: "2", title: "Frontend Engineer", status: "PUBLISHED", location: "Hồ Chí Minh", department: "Engineering", ownerName: "Chi", deadline: "2026-09-30", updatedAt: "2026-08-15" },
  ];
  const originalIds = rows.map((row) => row.id);
  const result = buildRecruiterJobTable(rows, { query: "engineer", status: "PUBLISHED", sort: "DEADLINE_ASC", page: 1, pageSize: 1 });

  assert.deepEqual(result.items.map((row) => row.id), ["2"]);
  assert.equal(result.filteredCount, 2);
  assert.equal(result.totalPages, 2);
  assert.deepEqual(rows.map((row) => row.id), originalIds);
});

test("recruiter Job table clamps an outdated page after client filters change", () => {
  const rows: RecruiterJobTableRow[] = [
    { id: "1", title: "A", status: "DRAFT", location: "HN", department: "IT", ownerName: "An", deadline: "2026-09-10", updatedAt: "2026-08-20" },
    { id: "2", title: "B", status: "PUBLISHED", location: "HN", department: "IT", ownerName: "An", deadline: "2026-09-11", updatedAt: "2026-08-21" },
  ];
  const result = buildRecruiterJobTable(rows, { query: "", status: "DRAFT", sort: "UPDATED_DESC", page: 9, pageSize: 5 });

  assert.equal(result.page, 1);
  assert.equal(result.from, 1);
  assert.equal(result.to, 1);
});

test("recruiter Job scope explains the backend list boundary for OWNER and MEMBER", () => {
  assert.match(recruiterJobScopeView("OWNER").description, /mọi tin/);
  assert.match(recruiterJobScopeView("MEMBER").description, /do bạn tạo/);
  assert.notEqual(recruiterJobScopeView("OWNER").label, recruiterJobScopeView("MEMBER").label);
});

test("only exact JOB_ACCESS_DENIED 403 triggers a recruiter Job scope refresh", () => {
  assert.equal(isRecruiterJobAccessDenied(new ApiClientError({ code: "JOB_ACCESS_DENIED", status: 403 })), true);
  assert.equal(isRecruiterJobAccessDenied(new ApiClientError({ code: "COMPANY_OWNER_REQUIRED", status: 403 })), false);
  assert.equal(isRecruiterJobAccessDenied(new ApiClientError({ code: "JOB_ACCESS_DENIED", status: 409 })), false);
});

const validJobForm: RecruiterJobFormValues = {
  currency: "VND",
  title: "Frontend Developer",
  description: "Xây dựng sản phẩm web.",
  requirements: "Có kinh nghiệm React.",
  benefits: "Bảo hiểm và ngân sách học tập.",
  salaryMin: "18000000",
  salaryMax: "25000000",
  isNegotiable: false,
  location: "Hà Nội",
  jobType: "FULL_TIME",
  experienceYears: "2",
  quantity: "3",
  skills: "React, TypeScript",
  deadline: "2026-09-02",
};

test("PUBLISHED Job edits need admin review only when review fields change", () => {
  for (const change of [{ deadline: "2026-12-31" }, { quantity: "9" }, { skills: "React, Next.js" }, { benefits: "Thêm 13 tháng lương." }, { location: "Đà Nẵng" }, { title: "  Frontend Developer  " }]) {
    assert.equal(jobEditRequiresReview(validJobForm, { ...validJobForm, ...change }), false, JSON.stringify(change));
  }
  for (const change of [{ title: "Senior Frontend Developer" }, { description: "Mô tả mới." }, { requirements: "Có kinh nghiệm Vue." }, { salaryMax: "30000000" }, { currency: "usd" }, { isNegotiable: true }]) {
    assert.equal(jobEditRequiresReview(validJobForm, { ...validJobForm, ...change }), true, JSON.stringify(change));
  }
});

test("Job form validates the backend deadline, salary and skill invariants", () => {
  const now = new Date("2026-08-31T23:30:00+07:00");
  assert.deepEqual(validateRecruiterJobForm(validJobForm, now), {});
  assert.equal(validateRecruiterJobForm({ ...validJobForm, deadline: "2026-08-31" }, now).deadline, "Hạn nộp phải sau hôm nay.");
  assert.ok(validateRecruiterJobForm({ ...validJobForm, salaryMin: "", salaryMax: "0" }, now).salary);
  assert.ok(validateRecruiterJobForm({ ...validJobForm, salaryMin: "30", salaryMax: "20" }, now).salary);
  assert.ok(validateRecruiterJobForm({ ...validJobForm, skills: " ,　, " }, now).skills);
  assert.ok(validateRecruiterJobForm({ ...validJobForm, skills: Array.from({ length: 51 }, (_, index) => `skill-${index}`).join(",") }, now).skills);
});

test("negotiable Job payload omits salaries and normalizes unique skills", () => {
  const payload = normalizeRecruiterJobForm({
    ...validJobForm,
    isNegotiable: true,
    salaryMin: "100",
    salaryMax: "200",
    skills: " React, react, ＴｙｐｅＳｃｒｉｐｔ , ",
  });
  assert.equal("salaryMin" in payload, false);
  assert.equal("salaryMax" in payload, false);
  assert.deepEqual(payload.skills, ["React", "TypeScript"]);
  assert.deepEqual(normalizeJobSkills("Vue, vue, React"), ["Vue", "React"]);
});

test("public Job search validates and normalizes all cursor-bound filters", () => {
  const values = {
    q: "  React　Developer ",
    location: " Hà Nội ",
    salaryMin: "18000000",
    salaryMax: "25000000",
    skills: "React, TypeScript",
    experienceYears: "2",
    jobType: "FULL_TIME" as const,
    sort: "NEWEST" as const,
  };
  assert.deepEqual(validatePublicJobSearch(values), {});
  assert.deepEqual(normalizePublicJobSearch(values), {
    q: "React Developer",
    location: "Hà Nội",
    salaryMin: 18000000,
    salaryMax: 25000000,
    skills: ["React", "TypeScript"],
    experienceYears: 2,
    jobType: "FULL_TIME",
    sort: "NEWEST",
  });
  assert.ok(validatePublicJobSearch({ ...values, salaryMin: "30", salaryMax: "20" }).salary);
});

test("public Job pagination enforces the offset window and appends cursor pages without duplicates", () => {
  assert.equal(isOffsetWindowTooDeep(500, 20), false);
  assert.equal(isOffsetWindowTooDeep(501, 20), true);
  assert.deepEqual(mergePublicJobPage([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }], true), [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(mergePublicJobPage([{ id: "a" }], [{ id: "b" }], false), [{ id: "b" }]);
  assert.notEqual(
    publicJobSearchScope({ q: "React", sort: "RELEVANCE" }, 20),
    publicJobSearchScope({ q: "React", sort: "NEWEST" }, 20),
  );
});

test("only stale Job and recommendation cursors restart their owning list", () => {
  assert.equal(cursorRestartView("JOB_SEARCH_CURSOR_STALE")?.code, "JOB_SEARCH_CURSOR_STALE");
  assert.equal(cursorRestartView("RECOMMENDATION_CURSOR_STALE")?.code, "RECOMMENDATION_CURSOR_STALE");
  assert.equal(cursorRestartView("JOB_SEARCH_CURSOR_SCOPE_MISMATCH"), null);
  assert.equal(cursorRestartView("JOB_SEARCH_PAGE_TOO_DEEP"), null);
});

test("Job and recommendation sources have transparent user-facing context", () => {
  assert.match(jobDataSourceView("ELASTICSEARCH").description, /chỉ mục/i);
  assert.match(jobDataSourceView("POSTGRESQL").description, /PostgreSQL/);
  assert.match(recommendationSourceView("AI").label, /AI/);
  assert.notEqual(recommendationSourceView("PREFERENCES").label, recommendationSourceView("LATEST").label);
});

test("every candidate recommendation fallback has a distinct recovery CTA", () => {
  const reasons = ["NO_ACTIVE_CV", "PROFILE_UNAVAILABLE", "AI_UNAVAILABLE", "AI_NOT_READY", "AI_RESPONSE_INVALID", "AI_RESULTS_STALE"] as const;
  const views = reasons.map((reason) => recommendationFallbackView(reason));
  assert.ok(views.every(Boolean));
  assert.equal(new Set(views.map((view) => view?.actionLabel)).size, reasons.length);
  assert.equal(recommendationFallbackView("NO_ACTIVE_CV")?.action, "UPLOAD_CV");
  assert.equal(recommendationFallbackView("NO_MATCHING_CV_EMBEDDINGS"), null);
});

test("recommendation pagination is enabled only for AI with an opaque next cursor", () => {
  assert.equal(canLoadMoreRecommendations("AI", "opaque-next"), true);
  assert.equal(canLoadMoreRecommendations("AI", null), false);
  assert.equal(canLoadMoreRecommendations("PREFERENCES", "unexpected"), false);
  assert.equal(canLoadMoreRecommendations("LATEST", "unexpected"), false);
  assert.deepEqual(
    mergeRecommendationPage([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }], true),
    [{ id: "a" }, { id: "b" }, { id: "c" }],
  );
});

test("every recruiter candidate empty reason is a normal 200-state with contextual recovery", () => {
  const reasons: CandidateRecommendationEmptyReason[] = [
    "NO_DISCOVERABLE_CANDIDATES",
    "JOB_EMBEDDING_NOT_FOUND",
    "JOB_EMBEDDING_INACTIVE",
    "NO_ACTIVE_CV_EMBEDDINGS",
    "EMBEDDING_MODEL_MISMATCH",
    "NO_MATCHING_CV_EMBEDDINGS",
  ];
  const views = reasons.map(candidateRecommendationEmptyView);
  assert.equal(views.length, 6);
  assert.ok(views.every((view) => view.title && view.description && view.actionLabel));
  assert.match(candidateRecommendationEmptyView("NO_DISCOVERABLE_CANDIDATES").description, /consent|Profile Service/i);
  assert.equal(candidateRecommendationEmptyView("NO_MATCHING_CV_EMBEDDINGS").action, "EDIT_JOB");
});


test("Job form preserves all backend types and rejects the removed CONTRACT type", () => {
  for (const jobType of ["FULL_TIME", "PART_TIME", "REMOTE", "INTERNSHIP"] as const) {
    const form = { ...validJobForm, jobType, currency: "USD" };
    assert.equal(validateRecruiterJobForm(form, new Date("2026-09-01T00:00:00Z")).jobType, undefined);
    assert.equal(normalizeRecruiterJobForm(form).jobType, jobType);
    assert.equal(normalizeRecruiterJobForm(form).currency, "USD");
  }
  assert.ok(validateRecruiterJobForm({ ...validJobForm, jobType: "CONTRACT" as RecruiterJobFormValues["jobType"] }).jobType);
});

test("Job search accepts REMOTE and INTERNSHIP without changing their wire values", () => {
  for (const jobType of ["REMOTE", "INTERNSHIP"] as const) {
    const form = { ...emptyPublicJobSearchForm, jobType };
    assert.deepEqual(validatePublicJobSearch(form), {});
    assert.equal(normalizePublicJobSearch(form).jobType, jobType);
  }
});
