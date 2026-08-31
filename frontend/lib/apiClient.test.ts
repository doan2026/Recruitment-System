import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiClientError,
  assertCanonicalUuidV4,
  clearApiSession,
  buildQuery,
  collectionPath,
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
import { normalizeJobSkills, normalizeRecruiterJobForm, validateRecruiterJobForm, type RecruiterJobFormValues } from "./jobForm";
import { buildRecruiterJobTable, type RecruiterJobTableRow } from "./recruiterJobTable";
import { isRecruiterJobAccessDenied, recruiterJobScopeView } from "./recruiterJobAccess";
import { isOffsetWindowTooDeep, mergePublicJobPage, normalizePublicJobSearch, publicJobSearchScope, validatePublicJobSearch } from "./publicJobSearch";
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
