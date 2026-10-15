import { expect, test, type Page, type Route } from "@playwright/test";

const gateway = "http://127.0.0.1:4173/api";
test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:4173/api/notifications**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: route.request().url().includes("unread-count") ? { unread_count: 0 } : [], meta: null }),
  }));
  await page.route("http://127.0.0.1:4173/api/auth/me", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ code: "AUTH_INVALID" }),
  }));
});

const jobId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const companyId = "3795c0de-7908-4ab5-9bed-4c4f1cf9c212";
const accountId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c213";
const applicationId = "5795c0de-7908-4ab5-9bed-4c4f1cf9c214";
const offerId = "6795c0de-7908-4ab5-9bed-4c4f1cf9c215";
const job = {
  id: jobId, companyId, title: "Remote Engineer", createdBy: accountId,
  description: "Xây dựng nền tảng tuyển dụng.", requirements: "Có kinh nghiệm TypeScript.",
  benefits: "Làm việc linh hoạt.", salaryMin: 1200, salaryMax: 2400,
  isNegotiable: false, currency: "USD", location: "Hà Nội", jobType: "REMOTE",
  experienceYears: 2, quantity: 1, skills: ["TypeScript"], deadline: "2099-12-31",
  status: "PUBLISHED", aggregateVersion: 7, rejectionReason: null,
  createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
};

async function reply(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:4173", "access-control-allow-credentials": "true", "access-control-allow-headers": "*" },
    body: JSON.stringify(status >= 400 ? data : { data, meta: null }),
  });
}

async function authenticate(page: Page, role: "CANDIDATE" | "RECRUITER", destination: string) {
  await page.route(`${gateway}/auth-cookie/login`, (route) => reply(route, { user: { id: accountId, role, email: "fixture@example.com" },
  }));
  await page.goto(`/login?returnTo=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(destination.replace(/[.*+?^$()|[\]\\]/g, "\\$&")));
}

test("anonymous public job detail loads without any private recommendation request and preserves USD", async ({ page }) => {
  let privateReads = 0;
  await page.route(`${gateway}/jobs/recommended**`, (route) => { privateReads += 1; return reply(route, { code: "UNAUTHORIZED" }, 401); });
  await page.route(`${gateway}/jobs/${jobId}`, (route) => reply(route, job));
  await page.goto(`/candidate/jobs/${jobId}`);
  await expect(page.getByRole("heading", { name: job.title, exact: true })).toBeVisible();
  await expect(page.getByText("1.200 USD – 2.400 USD", { exact: true })).toBeVisible();
  await expect(page.getByText("Làm việc từ xa", { exact: true })).toBeVisible();
  expect(privateReads).toBe(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath("public-job-detail.png"), fullPage: true });
});

test("recruiter create sends a supported INTERNSHIP type and selected currency", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route(`${gateway}/jobs/`, (route) => {
    writes.push(route.request().postDataJSON());
    return reply(route, { ...job, ...writes[0], status: "DRAFT", aggregateVersion: 1 }, 201);
  });
  await authenticate(page, "RECRUITER", "/recruiter/jobs/new");
  await page.locator("#title").fill("Intern Engineer");
  await page.locator("#description").fill("Phát triển tính năng có người hướng dẫn.");
  await page.locator("#requirements").fill("Biết TypeScript.");
  await page.locator("#benefits").fill("Phụ cấp và đào tạo.");
  await page.locator("#jobType").selectOption("INTERNSHIP");
  await page.locator("#currency").fill("USD");
  await page.locator("#salary").fill("1000");
  await page.locator("#salaryMax").fill("1500");
  await page.locator("#deadline").fill("2099-12-31");
  await page.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ jobType: "INTERNSHIP", currency: "USD", salaryMin: 1000, salaryMax: 1500 });
});

test("editing a REMOTE draft retains currency and sends the loaded expectedVersion", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route(`${gateway}/jobs/mine`, (route) => reply(route, [{ ...job, status: "DRAFT" }]));
  await page.route(`${gateway}/jobs/${jobId}`, (route) => {
    writes.push(route.request().postDataJSON());
    return reply(route, { ...job, ...writes[0], status: "DRAFT", aggregateVersion: 8 });
  });
  await page.route(`${gateway}/jobs/${jobId}/publish`, (route) => reply(route, { ...job, status: "PENDING_APPROVAL", aggregateVersion: 9 }));
  await authenticate(page, "RECRUITER", `/recruiter/jobs/${jobId}/edit`);
  await expect(page.locator("#jobType")).toHaveValue("REMOTE");
  await expect(page.locator("#currency")).toHaveValue("USD");
  await page.locator("#title").fill("Remote Engineer Updated");
  await page.getByRole("button", { name: "Lưu và gửi admin duyệt", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ jobType: "REMOTE", currency: "USD", expectedVersion: 7, title: "Remote Engineer Updated" });
});

test("candidate AI recommendations link to job detail with their actual source", async ({ page }) => {
  await page.route(`${gateway}/jobs/search**`, (route) => reply(route, { items: [], total: 0, page: 1, limit: 10, source: "POSTGRESQL", hasMore: false, nextCursor: null }));
  await page.route(`${gateway}/jobs/recommended**`, (route) => reply(route, { items: [{ ...job, score: 0.9 }], source: "AI", fallbackReason: null, nextCursor: null }));
  await page.route(`${gateway}/jobs/${jobId}`, (route) => reply(route, job));
  await authenticate(page, "CANDIDATE", "/candidate/jobs");
  const link = page.getByRole("link", { name: job.title, exact: true });
  await expect(link).toHaveAttribute("href", `/candidate/jobs/${jobId}?source=AI_RECOMMENDATION`);
  await link.click();
  await expect(page).toHaveURL(new RegExp("source=AI_RECOMMENDATION"));
  await expect(page.getByRole("heading", { name: job.title, exact: true })).toBeVisible();
});

test("recruiter candidate cursor appends unique candidates beyond the first page", async ({ page }) => {
  const cursors: (string | null)[] = [];
  await page.route(`${gateway}/jobs/mine`, (route) => reply(route, [job]));
  const candidate = (id: string, fullName: string) => ({ candidateId: id, fullName, headline: "Engineer", skills: ["TypeScript"], score: 0.9 });
  await page.route(`${gateway}/jobs/${jobId}/recommended-candidates**`, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    return reply(route, {
      jobId, items: cursor ? [candidate("b", "Ứng viên B"), candidate("c", "Ứng viên C")] : [candidate("a", "Ứng viên A"), candidate("b", "Ứng viên B")],
      nextCursor: cursor ? null : "opaque-page-two", reason: null,
    });
  });
  await authenticate(page, "RECRUITER", "/recruiter/candidate-recommendations");
  await page.getByRole("button", { name: "Xem thêm ứng viên", exact: true }).click();
  await expect(page.locator(".candidate-recommendation-card")).toHaveCount(3);
  await expect(page.getByText("Đã tải hết ứng viên trong danh sách gợi ý.")).toBeVisible();
  expect(cursors).toEqual([null, "opaque-page-two"]);
});

test("candidate opens application history then responds to a real Offer with both current versions", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  const offer = { id: offerId, applicationId, position: job.title, salary: "25000000", startDate: "2099-12-31", note: "Chào mừng bạn.", status: "SENT", sentAt: "2026-09-10T00:00:00Z", expiresAt: "2099-12-31T00:00:00Z", version: 2, applicationVersion: 5, applicationStatus: "OFFER", fileId: null, fileUrl: null, respondedAt: null, responseNote: null };
  await page.route(`${gateway}/applications/${applicationId}`, (route) => reply(route, {
    id: applicationId, jobId, companyId, jobTitle: job.title, candidateId: accountId, status: "OFFER", version: 5, offerId, coverLetter: "Thư ứng tuyển đã gửi.", appliedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z",
    timeline: [{ fromStatus: "REVIEWING", toStatus: "INTERVIEW", note: "Mời trao đổi chuyên môn.", changedAt: "2026-09-02T00:00:00Z" }],
  }));
  await page.route(`${gateway}/offers/${offerId}`, (route) => reply(route, offer));
  await page.route(`${gateway}/offers/${offerId}/respond`, (route) => {
    writes.push(route.request().postDataJSON());
    return reply(route, { ...offer, status: "ACCEPTED", version: 3, applicationVersion: 6, applicationStatus: "HIRED" });
  });
  await authenticate(page, "CANDIDATE", `/candidate/applications/${applicationId}`);
  await expect(page.getByText("Mời trao đổi chuyên môn.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Xem và phản hồi Offer", exact: true }).click();
  await page.getByRole("button", { name: "Chấp nhận", exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("alertdialog").getByRole("button", { name: "Chấp nhận Offer", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ decision: "ACCEPTED", expectedOfferVersion: 2, expectedApplicationVersion: 5 });
  await expect(page.getByText("Đã chấp nhận Offer.", { exact: true })).toBeVisible();
});

test("existing evaluation is fetched and shown instead of inviting a duplicate submission", async ({ page }) => {
  await page.route(`${gateway}/jobs/mine`, (route) => reply(route, [{ ...job, status: "CLOSED" }]));
  await page.route(`${gateway}/applications/?**`, (route) => reply(route, { items: [{ id: applicationId, jobId, candidateId: accountId, jobTitle: job.title, status: "INTERVIEW", version: 3, appliedAt: "2026-09-01T00:00:00Z" }], page: 0, size: 20, totalElements: 1, totalPages: 1 }));
  await page.route(`${gateway}/applications/${applicationId}/evaluations`, (route) => reply(route, [{ id: "evaluation-one", applicationId, evaluatorId: accountId, score: 88, criteria: { technical: 90, communication: 85, culture: 90 }, note: "Ghi chú đánh giá đã lưu.", createdAt: "2026-09-02T00:00:00Z" }]));
  await authenticate(page, "RECRUITER", `/recruiter/jobs/${jobId}`);
  await page.getByRole("button", { name: "Xem và đánh giá ứng viên", exact: true }).click();
  await expect(page.getByText("Ghi chú đánh giá đã lưu.", { exact: true })).toBeVisible();
  await expect(page.getByText("Bạn đã đánh giá", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu đánh giá", exact: true })).toHaveCount(0);
});


test("published Job edits require confirmation and do not call publish after backend requeues them", async ({ page }) => {
  let updates = 0;
  let publishes = 0;
  await page.route(`${gateway}/jobs/mine`, (route) => reply(route, [job]));
  await page.route(`${gateway}/jobs/${jobId}`, (route) => {
    updates += 1;
    return reply(route, { ...job, ...route.request().postDataJSON(), status: "PENDING_APPROVAL", aggregateVersion: 8 });
  });
  await page.route(`${gateway}/jobs/${jobId}/publish`, (route) => { publishes += 1; return reply(route, { code: "INVALID_TRANSITION" }, 409); });
  await authenticate(page, "RECRUITER", `/recruiter/jobs/${jobId}/edit`);
  await page.locator("#title").fill("Published Engineer Updated");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(updates).toBe(0);
  await page.getByRole("alertdialog").getByRole("button", { name: "Lưu và gửi duyệt lại", exact: true }).click();
  await expect(page.getByText("Đã lưu thay đổi. Tin đang chờ admin duyệt trước khi công khai.", { exact: true })).toBeVisible();
  expect(updates).toBe(1);
  expect(publishes).toBe(0);
});

test("deadline-only edits keep a published Job public without the re-review dialog", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route(`${gateway}/jobs/mine`, (route) => reply(route, [job]));
  await page.route(`${gateway}/jobs/${jobId}`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    return reply(route, { ...job, ...body, status: "PUBLISHED", aggregateVersion: 8 });
  });
  await authenticate(page, "RECRUITER", `/recruiter/jobs/${jobId}/edit`);
  await page.locator("#deadline").fill("2099-06-30");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByText("Đã lưu thay đổi.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ deadline: "2099-06-30", expectedVersion: 7, title: job.title, requirements: job.requirements });
});

test("private recommendation failure never hides a successfully loaded public Job", async ({ page }) => {
  await page.route(`${gateway}/jobs/${jobId}`, (route) => reply(route, job));
  await page.route(`${gateway}/jobs/recommended**`, (route) => reply(route, { code: "RECOMMENDATION_UNAVAILABLE" }, 503));
  await page.route(`${gateway}/profile/cvs**`, (route) => reply(route, []));
  await page.route(`${gateway}/applications/bookmarks`, (route) => reply(route, []));
  await authenticate(page, "CANDIDATE", `/candidate/jobs/${jobId}`);
  await expect(page.getByRole("heading", { name: job.title, exact: true })).toBeVisible();
  await expect(page.getByText("Gợi ý tạm thời chưa sẵn sàng. Bạn vẫn có thể đọc và ứng tuyển tin này.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ứng tuyển", exact: true })).toBeVisible();
});

test("an empty fallback retains NO_ACTIVE_CV guidance instead of a blank recommendation panel", async ({ page }) => {
  await page.route(`${gateway}/jobs/search**`, (route) => reply(route, { items: [], total: 0, page: 1, limit: 10, source: "POSTGRESQL", hasMore: false, nextCursor: null }));
  await page.route(`${gateway}/jobs/recommended**`, (route) => reply(route, { items: [], source: "LATEST", fallbackReason: "NO_ACTIVE_CV", nextCursor: null }));
  await authenticate(page, "CANDIDATE", "/candidate/jobs");
  await expect(page.getByText("Chưa có CV đang hoạt động", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở quản lý CV", exact: true })).toHaveAttribute("href", "/candidate/profile/cvs");
});

test("an Offer expiring while its confirmation is open is not sent", async ({ page }) => {
  let responses = 0;
  await page.clock.setFixedTime(new Date("2099-01-01T00:00:00Z"));
  await page.route(`${gateway}/offers/${offerId}`, (route) => reply(route, {
    id: offerId, applicationId, position: job.title, salary: "25000000",
    startDate: "2099-12-31", note: null, status: "SENT",
    expiresAt: "2099-01-01T00:01:00Z", version: 2,
    applicationVersion: 5, applicationStatus: "OFFER",
  }));
  await page.route(`${gateway}/offers/${offerId}/respond`, (route) => {
    responses += 1;
    return reply(route, { code: "OFFER_EXPIRED" }, 409);
  });
  await authenticate(page, "CANDIDATE", `/candidate/offers/${offerId}`);
  await page.getByRole("button", { name: "Chấp nhận", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.clock.setFixedTime(new Date("2099-01-01T00:01:01Z"));
  await page.getByRole("alertdialog").getByRole("button", { name: "Chấp nhận Offer", exact: true }).click();
  await expect(page.getByText("Offer đã hết hạn", { exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(responses).toBe(0);
});
