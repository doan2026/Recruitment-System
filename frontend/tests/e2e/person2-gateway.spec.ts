import { expect, test, type Page, type Route } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:4173/api/auth-cookie/refresh", route => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ code: "AUTH_INVALID" }),
  }));
  await page.route("http://127.0.0.1:4173/api/notifications**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: route.request().url().includes("unread-count") ? { unread_count: 0 } : [], meta: null }),
  }));
  await page.route("http://127.0.0.1:4173/api/auth/me", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ code: "AUTH_INVALID" }),
  }));
});

const appOrigin = "http://127.0.0.1:4173";
const gatewayOrigin = "http://127.0.0.1:4173/api";

const corsHeaders = {
  "access-control-allow-origin": appOrigin,
  "access-control-allow-credentials": "true",
  "content-type": "application/json",
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
}


async function login(page: Page, role: "CANDIDATE" | "RECRUITER", returnTo: string) {
  await page.route(`${gatewayOrigin}/auth-cookie/login`, (route) => json(route, {
    data: {
      user: { id: "5795c0de-7908-4ab5-9bed-4c4f1cf9c214", email: "test@example.test", role },
    }, meta: null,
  }));
  await page.goto(`${role === "RECRUITER" ? "/recruiter/login" : "/login"}?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(role === "RECRUITER" ? "Email công việc" : "Email", { exact: true }).fill("test@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(new URL(returnTo, appOrigin).toString());
}

async function expectNoDocumentOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0);
}

test("Company search consumes the Gateway envelope and remains usable on narrow screens", async ({ page }) => {
  const seenQueries: URLSearchParams[] = [];
  await page.route(`${gatewayOrigin}/companies/search**`, async (route) => {
    const url = new URL(route.request().url());
    seenQueries.push(url.searchParams);
    await json(route, {
      data: [{
        id: "1795c0de-7908-4ab5-9bed-4c4f1cf9c210",
        name: "Công ty Sản phẩm Việt",
        slug: "cong-ty-san-pham-viet",
        industry: "Công nghệ",
        size: "51-200",
        address: "Hà Nội",
        logoUrl: null,
      }],
      meta: { limit: 20, hasMore: false, nextCursor: null },
    });
  });

  await page.goto("/companies");

  await expect(page.getByRole("heading", { name: "Khám phá doanh nghiệp" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Công ty Sản phẩm Việt" })).toBeVisible();
  await expect(page.getByText("Đã hiển thị hết kết quả.")).toBeVisible();
  expect(seenQueries.length).toBeGreaterThanOrEqual(1);
  for (const query of seenQueries) {
    expect(query.get("limit")).toBe("20");
    expect(query.has("cursor")).toBe(false);
  }

  const search = page.getByRole("searchbox", { name: "Tên công ty" });
  await search.fill("CareerHub");
  await expect(page.getByRole("button", { name: "Xóa từ khóa công ty" })).toBeVisible();
  await page.getByRole("button", { name: "Xóa từ khóa công ty" }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expectNoDocumentOverflow(page);
});

test("Company search maps a Gateway failure safely and never renders the raw service message", async ({ page }) => {
  let attempts = 0;
  await page.route(`${gatewayOrigin}/companies/search**`, async (route) => {
    attempts += 1;
    await json(route, {
      code: "COMPANY_SEARCH_UNAVAILABLE",
      message: "internal-host=db-prod secret-token=do-not-render",
    }, 503);
  });

  await page.goto("/companies");

  await expect(page.locator("main [role='alert']")).toContainText("Không thể hoàn tất yêu cầu. Hãy thử lại.");
  await expect(page.getByText(/internal-host|secret-token/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test("Job search and recommendations preserve their distinct Gateway contracts", async ({ page }) => {
  const backendJob = {
    id: "2795c0de-7908-4ab5-9bed-4c4f1cf9c211",
    companyId: "3795c0de-7908-4ab5-9bed-4c4f1cf9c212",
    companyName: "Công ty Sản phẩm Việt",
    title: "Backend Engineer",
    description: "Xây dựng nền tảng tuyển dụng.",
    requirements: ["Java", "Kafka"],
    benefits: ["Bảo hiểm"],
    salaryMin: 25_000_000,
    salaryMax: 40_000_000,
    isNegotiable: false,
    location: "Hà Nội",
    jobType: "FULL_TIME",
    currency: "VND",
    aggregateVersion: 1,
    experienceYears: 3,
    quantity: 2,
    skills: ["Java", "Kafka"],
    deadline: "2026-12-31T00:00:00.000Z",
    status: "PUBLISHED",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  const searchQueries: URLSearchParams[] = [];
  const recommendationQueries: URLSearchParams[] = [];

  await page.route(`${gatewayOrigin}/jobs/search**`, async (route) => {
    searchQueries.push(new URL(route.request().url()).searchParams);
    await json(route, {
      data: {
        items: [backendJob], total: 1, page: 1, limit: 10,
        source: "ELASTICSEARCH", nextCursor: null, hasMore: false,
      },
      meta: null,
    });
  });
  await page.route(`${gatewayOrigin}/jobs/recommended**`, async (route) => {
    recommendationQueries.push(new URL(route.request().url()).searchParams);
    await json(route, {
      data: { items: [{ ...backendJob, score: 0.91 }], nextCursor: null, source: "AI", fallbackReason: null },
      meta: null,
    });
  });

  await login(page, "CANDIDATE", "/candidate/jobs");

  await expect(page.getByRole("heading", { name: "Việc làm công khai" })).toBeVisible();
  await expect(page.getByText("Backend Engineer", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/Nguồn dữ liệu: Chỉ mục tìm kiếm —/)).toBeVisible();
  await expect(page.getByText("AI theo CV", { exact: true })).toBeVisible();
  expect(searchQueries.length).toBeGreaterThanOrEqual(1);
  expect(recommendationQueries.length).toBeGreaterThanOrEqual(1);
  for (const query of searchQueries) {
    expect(query.get("pagination")).toBe("OFFSET");
    expect(query.get("page")).toBe("1");
    expect(query.get("limit")).toBe("10");
  }
  for (const query of recommendationQueries) {
    expect(query.get("limit")).toBe("10");
    expect(query.has("cursor")).toBe(false);
  }
  await expectNoDocumentOverflow(page);
});

test("Job edit keeps the local draft after one authoritative 409 reload and never retries the mutation", async ({ page }) => {
  const jobId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
  const baseJob = {
    id: jobId,
    companyId: "3795c0de-7908-4ab5-9bed-4c4f1cf9c212",
    companyName: "Công ty Sản phẩm Việt",
    title: "Backend ban đầu",
    description: "Xây dựng nền tảng tuyển dụng.",
    requirements: ["Java", "Kafka"],
    benefits: ["Bảo hiểm"],
    salaryMin: 25_000_000,
    salaryMax: 40_000_000,
    isNegotiable: false,
    location: "Hà Nội",
    jobType: "FULL_TIME",
    currency: "VND",
    aggregateVersion: 1,
    experienceYears: 3,
    quantity: 2,
    skills: ["Java", "Kafka"],
    deadline: "2026-12-31T00:00:00.000Z",
    status: "DRAFT",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  let conflictTriggered = false;
  let authoritativeReloads = 0;
  let updateCalls = 0;
  let publishCalls = 0;

  await page.route(`${gatewayOrigin}/jobs/mine`, async (route) => {
    if (conflictTriggered) authoritativeReloads += 1;
    await json(route, {
      data: [{
        ...baseJob,
        aggregateVersion: conflictTriggered ? 2 : 1,
        title: conflictTriggered ? "Backend phía server" : baseJob.title,
        updatedAt: conflictTriggered ? "2026-08-31T00:00:00.000Z" : baseJob.updatedAt,
      }],
      meta: null,
    });
  });
  await page.route(`${gatewayOrigin}/jobs/${jobId}`, async (route) => {
    updateCalls += 1;
    conflictTriggered = true;
    await json(route, { code: "JOB_STATE_CHANGED", details: { currentStatus: "DRAFT" } }, 409);
  });
  await page.route(`${gatewayOrigin}/jobs/${jobId}/publish`, async (route) => {
    publishCalls += 1;
    await json(route, { data: { ...baseJob, status: "PENDING_APPROVAL" }, meta: null });
  });

  await login(page, "RECRUITER", `/recruiter/jobs/${jobId}/edit`);
  const titleInput = page.getByRole("textbox", { name: "Tên vị trí" });
  await expect(titleInput).toHaveValue("Backend ban đầu");
  await titleInput.fill("Backend do tôi sửa");
  await page.getByRole("button", { name: "Lưu và gửi admin duyệt" }).click();

  await expect(page.getByRole("heading", { name: "Tin tuyển dụng vừa được người khác sửa" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Tên vị trí Backend do tôi sửa Backend phía server Khác nhau/ })).toBeVisible();
  await expect(titleInput).toHaveValue("Backend do tôi sửa");
  expect(updateCalls).toBe(1);
  expect(authoritativeReloads).toBe(1);
  expect(publishCalls).toBe(0);

  await page.getByRole("button", { name: "Dùng dữ liệu mới nhất" }).click();
  await expect(titleInput).toHaveValue("Backend phía server");
  await expect(page.getByText("Đã dùng bản mới nhất từ server.")).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test("Application tracking reloads authoritative version before withdraw", async ({ page }) => {
  const applicationId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c213";
  const application = {
    id: applicationId,
    jobId: "2795c0de-7908-4ab5-9bed-4c4f1cf9c211",
    companyId: "3795c0de-7908-4ab5-9bed-4c4f1cf9c212",
    candidateId: "5795c0de-7908-4ab5-9bed-4c4f1cf9c214",
    jobTitle: "Backend Engineer",
    status: "APPLIED",
    matchScore: 82,
    appliedAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  let detailReads = 0;
  let withdrawBody: Record<string, unknown> | null = null;
  let privateListHeaders: Record<string, string> = {};

  await page.route(`${gatewayOrigin}/applications/my`, async (route) => {
    privateListHeaders = route.request().headers();
    await json(route, { data: [application], meta: null });
  });
  await page.route(`${gatewayOrigin}/applications/${applicationId}`, async (route) => {
    detailReads += 1;
    await json(route, { data: { ...application, version: 7 }, meta: null });
  });
  await page.route(`${gatewayOrigin}/applications/${applicationId}/withdraw`, async (route) => {
    withdrawBody = route.request().postDataJSON() as Record<string, unknown>;
    await json(route, {
      data: {
        applicationId, fromStatus: "APPLIED", toStatus: "WITHDRAWN",
        updatedAt: "2026-08-31T00:00:00.000Z", version: 8,
      },
      meta: null,
    });
  });

  await login(page, "CANDIDATE", "/candidate/applications");
  await expect(page.getByRole("article").getByText(application.jobTitle, { exact: true })).toBeVisible();
  expect(detailReads).toBe(0);
  await page.getByRole("button", { name: "Rút hồ sơ", exact: true }).click();
  expect(withdrawBody).toBeNull();
  await page.getByRole("alertdialog").getByRole("button", { name: "Quay lại", exact: true }).click();
  expect(withdrawBody).toBeNull();
  await page.getByRole("button", { name: "Rút hồ sơ", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xác nhận rút hồ sơ", exact: true }).click();

  await expect(page.getByText("Đã rút hồ sơ ứng tuyển Backend Engineer.")).toBeVisible();
  await expect(page.getByText("Đã rút hồ sơ", { exact: true })).toBeVisible();
  expect(detailReads).toBe(1);
  const sentWithdraw = withdrawBody as unknown as Record<string, unknown>;
  expect(Object.keys(sentWithdraw).sort()).toEqual(["expectedVersion", "note"]);
  expect(sentWithdraw.expectedVersion).toBe(7);
  expect(privateListHeaders["cache-control"]).toBe("no-store");
  expect(privateListHeaders.authorization).toBeUndefined();
  await expectNoDocumentOverflow(page);
});

test("AI chat sends the exact private Gateway contract and renders the answer as text", async ({ page }) => {

  let requestBody: Record<string, unknown> | null = null;
  let privateHeaders: Record<string, string> = {};
  await page.route(`${gatewayOrigin}/ai/chat`, async (route) => {
    const request = route.request();
    requestBody = request.postDataJSON() as Record<string, unknown>;
    privateHeaders = request.headers();
    const sessionId = String(requestBody.session_id);
    await json(route, {
      data: {
        session_id: sessionId,
        answer: "Mở màn “Việc làm phù hợp” để xem chi tiết.\n1. Backend Engineer — mã việc 1795c0de-7908-4ab5-9bed-4c4f1cf9c210",
      },
      meta: null,
    });
  });

  await login(page, "CANDIDATE", "/ai");
  await expect(page.getByText("Sẵn sàng trò chuyện")).toBeVisible();
  await page.getByLabel("Tin nhắn cho trợ lý nghề nghiệp").fill("Gợi ý việc phù hợp cho tôi");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();

  await expect(page.getByText("Backend Engineer", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở Việc làm phù hợp" })).toHaveAttribute("href", "/candidate/jobs#suitable-jobs");
  const sentBody = requestBody as unknown as Record<string, unknown>;
  expect(Object.keys(sentBody).sort()).toEqual(["message", "session_id"]);
  expect(sentBody.message).toBe("Gợi ý việc phù hợp cho tôi");
  expect(sentBody.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(privateHeaders["cache-control"]).toBe("no-store");
  expect(privateHeaders.pragma).toBe("no-cache");
  expect(privateHeaders.authorization).toBeUndefined();
  await expectNoDocumentOverflow(page);
});

test("AI chat honors 429 Retry-After without replaying the message", async ({ page }) => {
  let attempts = 0;
  await page.route(`${gatewayOrigin}/ai/chat`, async (route) => {
    attempts += 1;
    await route.fulfill({
      status: 429,
      headers: { ...corsHeaders, "retry-after": "2" },
      body: JSON.stringify({ code: "CHAT_RATE_LIMITED", details: { retryAfterSeconds: 2 } }),
    });
  });

  await login(page, "CANDIDATE", "/ai");
  await expect(page.getByText("Sẵn sàng trò chuyện")).toBeVisible();
  const composer = page.getByLabel("Tin nhắn cho trợ lý nghề nghiệp");
  await composer.fill("Gợi ý việc phù hợp cho tôi");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();

  await expect(page.getByText(/Bạn đã gửi quá nhanh. Có thể gửi lại sau/)).toBeVisible();
  await expect(composer).toBeDisabled();
  await expect(page.getByRole("button", { name: /Chờ [12]s/ })).toBeDisabled();
  expect(attempts).toBe(1);
});


test("Recruiter job preview shows the selected saved job and provides working navigation without an inert submit", async ({ page }) => {
  const jobId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
  let jobReads = 0;
  let jobMutations = 0;
  const backendJob = {
    id: jobId,
    companyId: "3795c0de-7908-4ab5-9bed-4c4f1cf9c212",
    companyName: "Công ty Sản phẩm Việt",
    title: "Kỹ sư nền tảng dữ liệu",
    description: "Xây dựng hệ thống dữ liệu tuyển dụng có thể mở rộng.",
    requirements: "Có kinh nghiệm PostgreSQL\nCó kinh nghiệm xử lý sự kiện",
    benefits: "Hỗ trợ học tập chuyên môn",
    salaryMin: 25_000_000,
    salaryMax: 40_000_000,
    isNegotiable: false,
    location: "Đà Nẵng",
    jobType: "FULL_TIME",
    currency: "VND",
    aggregateVersion: 3,
    experienceYears: 3,
    quantity: 2,
    skills: ["PostgreSQL", "Kafka"],
    deadline: "2026-12-31T00:00:00.000Z",
    status: "DRAFT",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  await page.route(`${gatewayOrigin}/jobs/**`, async (route) => {
    if (route.request().method() !== "GET") jobMutations += 1;
    await json(route, { data: backendJob, meta: null });
  });
  await page.route(`${gatewayOrigin}/jobs/mine`, async (route) => {
    jobReads += 1;
    await json(route, { data: [backendJob], meta: null });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "RECRUITER", `/recruiter/jobs/${jobId}/preview`);

  await expect(page.getByRole("heading", { name: "Xem trước tin tuyển dụng", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: backendJob.title, exact: true })).toBeVisible();
  await expect(page.getByText(backendJob.description, { exact: true })).toBeVisible();
  await expect(page.getByText(backendJob.requirements.split("\n")[0], { exact: true })).toBeVisible();
  await expect(page.getByText(backendJob.benefits, { exact: true })).toBeVisible();
  await expect(page.getByText("Bản nháp", { exact: true })).toBeVisible();
  await expect(page.getByText("Vị trí: Senior Frontend Engineer", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gửi duyệt", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Quản lý tin", exact: true })).toHaveAttribute("href", "/recruiter/jobs");
  expect(jobReads).toBeGreaterThanOrEqual(1);
  expect(jobMutations).toBe(0);
  await expectNoDocumentOverflow(page);

  await page.getByRole("link", { name: "Quay lại sửa", exact: true }).click();
  await expect(page).toHaveURL(new URL(`/recruiter/jobs/${jobId}/edit`, appOrigin).toString());
  await expect(page.getByRole("textbox", { name: "Tên vị trí" })).toHaveValue(backendJob.title);
  expect(jobMutations).toBe(0);
});
