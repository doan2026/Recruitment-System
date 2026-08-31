import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = "http://127.0.0.1:4173";
const gatewayOrigin = "http://127.0.0.1:4174";

const corsHeaders = {
  "access-control-allow-origin": appOrigin,
  "access-control-allow-credentials": "true",
  "content-type": "application/json",
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
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

test("Job search and recommendations preserve their distinct Gateway contracts", async ({ context, page }) => {
  await context.addCookies([{
    name: "careerhub_session",
    value: "http-only-session-fixture",
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
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

  await page.goto("/candidate/jobs");

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

test("Application tracking reloads authoritative version before withdraw", async ({ context, page }) => {
  await context.addCookies([{
    name: "careerhub_session",
    value: "http-only-session-fixture",
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
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

  await page.goto("/candidate/applications");
  await expect(page.getByText("Phiên bản tải khi thao tác", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Rút hồ sơ" }).click();

  await expect(page.getByText("Đã rút hồ sơ ứng tuyển Backend Engineer.")).toBeVisible();
  await expect(page.getByText("WITHDRAWN", { exact: true })).toBeVisible();
  expect(detailReads).toBe(1);
  const sentWithdraw = withdrawBody as unknown as Record<string, unknown>;
  expect(Object.keys(sentWithdraw).sort()).toEqual(["expectedVersion", "note"]);
  expect(sentWithdraw.expectedVersion).toBe(7);
  expect(privateListHeaders["cache-control"]).toBe("no-store");
  expect(privateListHeaders.cookie).toContain("careerhub_session=http-only-session-fixture");
  await expectNoDocumentOverflow(page);
});

test("AI chat sends the exact private Gateway contract and renders the answer as text", async ({ context, page }) => {
  await context.addCookies([{
    name: "careerhub_session",
    value: "http-only-session-fixture",
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);

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

  await page.goto("/ai");
  await expect(page.getByText("Session sẵn sàng")).toBeVisible();
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
  expect(privateHeaders.cookie).toContain("careerhub_session=http-only-session-fixture");
  await expectNoDocumentOverflow(page);
});
