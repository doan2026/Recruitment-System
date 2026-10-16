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
const defaultCvId = "7795c0de-7908-4ab5-9bed-4c4f1cf9c216";
const selectedCvId = "8795c0de-7908-4ab5-9bed-4c4f1cf9c217";
const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "http://127.0.0.1:4173",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "*",
};
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
  await route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(status >= 400 ? data : { data, meta: null }) });
}

async function mockLogin(page: Page) {
  await page.route(`${gateway}/auth-cookie/login`, (route) => reply(route, {
    user: { id: accountId, role: "CANDIDATE", email: "fixture@example.com" },
  }));
}

async function submitLogin(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}

async function authenticate(page: Page, destination: string) {
  await mockLogin(page);
  await page.goto(`/login?returnTo=${encodeURIComponent(destination)}`);
  await submitLogin(page);
  await expect(page).toHaveURL(`http://127.0.0.1:4173${destination}`);
}

async function mockJobDetail(page: Page) {
  await page.route(`${gateway}/jobs/${jobId}`, (route) => reply(route, job));
  await page.route(`${gateway}/jobs/recommended**`, (route) => reply(route, {
    items: [], source: "AI", fallbackReason: null, nextCursor: null,
  }));
}

test("private applications stay gated anonymously and a failed refresh settles without a 401 remount loop", async ({ page }) => {
  let privateReads = 0;
  const refreshRequests: { authorization: string | undefined; body: unknown }[] = [];
  await page.route(`${gateway}/applications/my**`, (route) => {
    privateReads += 1;
    return reply(route, { code: "UNAUTHORIZED" }, 401);
  });
  await page.route(`${gateway}/auth-cookie/refresh`, (route) => {
    refreshRequests.push({
      authorization: route.request().headers().authorization,
      body: route.request().postDataJSON(),
    });
    return reply(route, { code: "INVALID_REFRESH_TOKEN" }, 401);
  });
  await mockLogin(page);
  await page.goto("/candidate/applications");
  await expect(page.getByRole("heading", { name: "Đăng nhập để tiếp tục", exact: true })).toBeVisible();
  expect(privateReads).toBe(0);
  // Anonymous hydration may try the HttpOnly refresh cookie once on reload.
  refreshRequests.length = 0;
  await page.locator(".empty-state").getByRole("link", { name: "Đăng nhập", exact: true }).click();
  await submitLogin(page);
  await expect.poll(() => refreshRequests.length).toBe(1);
  await expect(page.getByRole("heading", { name: "Đăng nhập để tiếp tục", exact: true })).toBeVisible();
  const settledReads = privateReads;
  // Observe a bounded interval after the gate settles, specifically to detect
  // the previous rapid unmount/remount request loop.
  await page.waitForTimeout(600);
  expect(privateReads).toBe(settledReads);
  expect(privateReads).toBeGreaterThan(0);
  expect(privateReads).toBeLessThanOrEqual(2);
  expect(refreshRequests).toEqual([{ authorization: undefined, body: {} }]);
});

test("Profile CV picker selects the default and sends the chosen CV with actual AI source only once", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await mockJobDetail(page);
  await page.route(`${gateway}/applications/bookmarks`, (route) => reply(route, []));
  await page.route(`${gateway}/profile/cvs`, (route) => reply(route, [
    { id: selectedCvId, title: "CV TypeScript chuyên sâu", type: "ONLINE", isDefault: false, createdAt: "2026-09-01T00:00:00Z" },
    { id: defaultCvId, title: "CV mặc định từ Profile", type: "UPLOAD", isDefault: true, createdAt: "2026-08-01T00:00:00Z" },
  ]));
  await page.route(`${gateway}/applications/`, async (route) => {
    writes.push(route.request().postDataJSON());
    await responseGate;
    await reply(route, {
      id: applicationId, jobId, companyId, candidateId: accountId, jobTitle: job.title,
      status: "APPLIED", version: 1, appliedAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z",
    }, 201);
  });
  await authenticate(page, `/candidate/jobs/${jobId}?source=AI_RECOMMENDATION`);
  const picker = page.getByLabel("CV dùng để ứng tuyển", { exact: true });
  await expect(picker).toHaveValue(defaultCvId);
  await picker.selectOption({ label: "CV TypeScript chuyên sâu" });
  await page.getByLabel("Thư ứng tuyển (tùy chọn)", { exact: true }).fill("  Tôi muốn ứng tuyển từ gợi ý AI.  ");
  try {
    // Two synchronous submits exercise the ref lock before React can disable
    // the button, as well as the visible pending state.
    await page.locator("form#apply").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => writes.length).toBe(1);
    await expect(page.getByRole("button", { name: "Đang gửi…", exact: true })).toBeDisabled();
    await expect(picker).toBeDisabled();
    expect(writes[0]).toEqual({ jobId, cvId: selectedCvId, coverLetter: "Tôi muốn ứng tuyển từ gợi ý AI.", source: "AI_RECOMMENDATION" });
  } finally {
    releaseResponse();
  }
  await expect(page.getByRole("button", { name: "Đã ứng tuyển", exact: true })).toBeDisabled();
  await expect(page.getByText("Đã gửi hồ sơ ứng tuyển. Trạng thái hiện tại: APPLIED.", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
});

test("bookmark save and both detail/list removals handle empty 204 responses", async ({ page }) => {
  let saved = false;
  const saves: unknown[] = [];
  const removals: string[] = [];
  const bookmark = {
    id: "bookmark-contract-one", jobId, createdAt: "2026-09-10T00:00:00Z",
    job: { ...job, exists: true, acceptingApplications: true, salaryMin: "1200", salaryMax: "2400", availabilityReason: null },
  };
  await mockJobDetail(page);
  await page.route(`${gateway}/profile/cvs`, (route) => reply(route, []));
  await page.route(`${gateway}/applications/bookmarks`, (route) => {
    if (route.request().method() === "POST") {
      saves.push(route.request().postDataJSON());
      saved = true;
      return reply(route, bookmark, 201);
    }
    return reply(route, saved ? [bookmark] : []);
  });
  await page.route(`${gateway}/applications/bookmarks/${jobId}`, async (route) => {
    removals.push(route.request().method());
    saved = false;
    await route.fulfill({ status: 204, headers: corsHeaders });
  });
  await authenticate(page, `/candidate/jobs/${jobId}`);
  await page.getByRole("button", { name: "Lưu việc làm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bỏ lưu việc làm", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Bỏ lưu việc làm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lưu việc làm", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(removals).toEqual(["DELETE"]);
  await page.getByRole("button", { name: "Lưu việc làm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bỏ lưu việc làm", exact: true })).toBeVisible();
  // Next Link navigation intentionally retains the in-memory account session.
  await page.getByRole("navigation", { name: "Khu vực ứng viên" }).getByRole("link", { name: "Việc làm đã lưu", exact: true }).click();
  await expect(page.getByRole("heading", { name: job.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bỏ lưu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chưa lưu việc làm", exact: true })).toBeVisible();
  await expect(page.getByText("Đã bỏ lưu việc làm.", { exact: true })).toBeVisible();
  expect(saves).toEqual([{ jobId }, { jobId }]);
  expect(removals).toEqual(["DELETE", "DELETE"]);
});

test("a late anonymous hydration response cannot clear a newer login", async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let hydrationStarted = false;
  await page.route(`${gateway}/auth/me`, async (route) => {
    hydrationStarted = true;
    await delayed;
    await reply(route, { code: "AUTH_INVALID" }, 401);
  });
  await mockLogin(page);
  await mockJobDetail(page);
  await page.route(`${gateway}/applications/bookmarks`, (route) => reply(route, []));
  await page.route(`${gateway}/profile/cvs`, (route) => reply(route, []));
  await page.goto(`/login?returnTo=${encodeURIComponent(`/candidate/jobs/${jobId}`)}`);
  await expect.poll(() => hydrationStarted).toBe(true);
  await submitLogin(page);
  await expect(page.getByRole("button", { name: "Đăng xuất", exact: true })).toBeVisible();
  const response = page.waitForResponse(`${gateway}/auth/me`);
  release();
  await response;
  await expect(page).toHaveURL(`http://127.0.0.1:4173/candidate/jobs/${jobId}`);
  await expect(page.getByRole("button", { name: "Đăng xuất", exact: true })).toBeVisible();
});
