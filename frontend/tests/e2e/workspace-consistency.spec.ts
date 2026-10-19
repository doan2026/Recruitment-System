import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

const origin = "http://127.0.0.1:4173";
const api = origin + "/api";
const accountId = "1795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const companyId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const jobId = "3795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const cvId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c211";
type Role = "CANDIDATE" | "RECRUITER" | "ADMIN";
const dashboards: Record<Role, string> = { CANDIDATE: "/candidate/dashboard", RECRUITER: "/recruiter/dashboard", ADMIN: "/admin" };
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(status < 400 ? { data, meta: null } : data) });

async function fixtureSession(page: Page, role: Role, destination: string) {
  // These are presentation fixtures only. Block every unmocked API and remote origin.
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route(api + "/**", route => reply(route, { code: "UNMOCKED_TEST_ENDPOINT" }, 404));
  await page.addInitScript(() => {
    class FixtureEventSource extends EventTarget { close() {} }
    (window as any).EventSource = FixtureEventSource;
  });
  await page.route(api + "/auth/me", route => reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/refresh", route => reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/login", route => reply(route, { user: { id: accountId, email: "workspace@example.test", role } }));
  await page.route(api + "/profile/" + accountId, route => reply(route, {
    userId: accountId, fullName: "Nguyễn Minh Anh", headline: "Kỹ sư phần mềm", summary: "Phát triển sản phẩm web và phối hợp cùng đội ngũ thiết kế, kiểm thử.",
    phone: "0901234567", address: "Thành phố Hồ Chí Minh", avatarUrl: null, completionPercent: 80, missingSections: ["certificates"],
    githubUrl: null, linkedinUrl: null, portfolioUrl: null,
    educations: [{ id: "education-fixture", school: "Đại học Công nghệ", major: "Công nghệ thông tin", startDate: "2017-09-01", endDate: "2021-06-01" }],
    experiences: [{ id: "experience-fixture", companyName: "Công ty Sản phẩm Việt", position: "Kỹ sư phần mềm", startDate: "2022-01-01", endDate: null, isCurrent: true }],
    skills: [{ id: "skill-fixture", name: "TypeScript", level: "Thành thạo" }], certificates: [], projects: [],
  }));
  await page.route(api + "/profile/cvs", route => reply(route, [
    { id: cvId, title: "CV Kỹ sư phần mềm", type: "ONLINE", isDefault: true, aggregateVersion: 2, revisionNumber: 2, createdAt: "2026-10-01T08:00:00Z" },
    { id: jobId, title: "CV sản phẩm web", type: "UPLOAD", isDefault: false, aggregateVersion: 1, revisionNumber: 1, createdAt: "2026-10-05T08:00:00Z" },
  ]));
  await page.route(api + "/applications/bookmarks", route => reply(route, [{ id: jobId, jobId, createdAt: "2026-10-01T08:00:00Z", job: null }]));
  await page.route(api + "/applications/my", route => reply(route, [{ id: cvId, jobId, candidateId: accountId, status: "APPLIED", appliedAt: "2026-10-01T08:00:00Z" }]));
  await page.route(api + "/interviews/my**", route => reply(route, { items: [{ id: cvId }], nextCursor: null }));
  await page.route(api + "/companies/me", route => reply(route, { id: companyId, name: "Công ty Sản phẩm Việt", taxCode: "0101234567", aggregateVersion: 1, verifiedStatus: "VERIFIED", media: [], createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z" }));
  await page.route(api + "/applications/stats**", route => reply(route, {
    companyId, generatedAt: "2026-10-19T08:00:00Z", range: { from: "2026-10-01", toExclusive: "2026-10-20", granularity: "DAY", timezone: "Asia/Ho_Chi_Minh" },
    summary: { activeJobs: { available: true, count: 3 }, totalApplications: 24, hiredApplications: 4, hiredRatePercent: 16.7 },
    statusCounts: { APPLIED: 12, REVIEWING: 8, HIRED: 4 }, warnings: [], funnel: [], timeSeries: [], sourceBreakdown: {},
    applicationsByJob: [{ jobId, jobTitle: "Kỹ sư phần mềm", totalApplications: 24, statusCounts: { APPLIED: 12, REVIEWING: 8, HIRED: 4 } }],
  }));
  await page.route(api + "/admin/stats/overview**", route => reply(route, {
    totals: { JOBS_PUBLISHED: 18, APPLIED: 120, INTERVIEW: 32, OFFER: 12, HIRED: 8 },
    daily: [{ metric: "APPLIED", stat_date: "2026-10-01", value: 10 }, { metric: "APPLIED", stat_date: "2026-10-02", value: 16 }, { metric: "APPLIED", stat_date: "2026-10-03", value: 12 }],
  }));
  await page.route(api + "/admin/stats/funnel**", route => reply(route, [{ stage: "APPLIED", count: 120, rate: 100 }, { stage: "INTERVIEW", count: 32, rate: 26.7 }, { stage: "HIRED", count: 8, rate: 6.7 }]));
  for (const endpoint of ["users", "jobs/pending", "companies/pending", "reports", "audit-logs"]) {
    await page.route(api + "/admin/" + endpoint + "**", route => reply(route, []));
  }
  await page.route(api + "/notifications/unread-count", route => reply(route, { unread_count: 1 }));
  await page.route(api + "/notifications", route => reply(route, [
    { id: "notification-one", type: "application", title: "Hồ sơ ứng tuyển đã được cập nhật", body: "Kiểm tra thông tin mới nhất trong hồ sơ ứng tuyển của bạn.", is_read: false, created_at: "2026-10-19T08:00:00Z" },
    { id: "notification-two", type: "application", title: "Hoạt động tuyển dụng", body: "Thông tin đã được lưu trong lịch sử hoạt động.", is_read: true, created_at: "2026-10-18T08:00:00Z" },
  ]));
  const loginPath = role === "ADMIN" ? "/admin/login" : role === "RECRUITER" ? "/recruiter/login" : "/login";
  await page.goto(loginPath + "?returnTo=" + encodeURIComponent(destination));
  await page.getByLabel(role === "ADMIN" ? "Email quản trị" : role === "RECRUITER" ? "Email công việc" : "Email", { exact: true }).fill("workspace@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("WorkspaceFixturePassword123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(origin + destination);
}

async function consistentWorkspace(page: Page, destination: string) {
  await expect(page.locator(".workspace-shell")).toHaveCount(1);
  await expect(page.locator(".workspace-header")).toHaveCount(1);
  await expect(page.locator(".workspace-sidebar")).toHaveCount(1);
  await expect(page.locator(".workspace-page h1")).toHaveCount(1);
  const active = page.locator('.workspace-navigation [aria-current="page"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute("href", destination);
  await expect(active).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const styles = await page.evaluate(() => {
    const heading = getComputedStyle(document.querySelector(".workspace-page h1")!);
    const selected = getComputedStyle(document.querySelector('.workspace-navigation [aria-current="page"]')!);
    const control = getComputedStyle(document.querySelector(".workspace-page .btn")!);
    const shell = document.querySelector(".workspace-shell")!.getBoundingClientRect();
    const header = document.querySelector(".workspace-header")!.getBoundingClientRect();
    const nav = document.querySelector(".workspace-sidebar")!.getBoundingClientRect();
    return { titleSize: heading.fontSize, titleWeight: heading.fontWeight, titleFont: heading.fontFamily,
      selectedColor: selected.backgroundColor, selectedMinHeight: selected.minHeight,
      controlRadius: control.borderRadius, controlMinHeight: control.minHeight, controlSize: control.fontSize,
      shellWidth: shell.width, headerWidth: header.width, sidebarWidth: nav.width, viewport: window.innerWidth };
  });
  expect(styles.titleSize).toBe(styles.viewport <= 680 ? "24px" : "28px");
  expect(styles.titleWeight).toBe("700");
  expect(styles.titleFont).toContain("Manrope");
  expect(styles.selectedColor).toBe("rgb(0, 110, 46)");
  expect(styles.selectedMinHeight).toBe("44px");
  expect(styles.controlRadius).toBe("8px");
  expect(styles.controlMinHeight).toBe("46px");
  expect(styles.controlSize).toBe("14px");
  expect(Math.abs(styles.headerWidth - styles.shellWidth)).toBeLessThanOrEqual(1);
  if (styles.viewport > 980) expect(styles.sidebarWidth).toBe(248);
  else expect(Math.abs(styles.sidebarWidth - styles.shellWidth)).toBeLessThanOrEqual(1);
}

async function saveScreenshot(page: Page, name: string, testInfo: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  const path = `/tmp/recruitment-ui-after-${name}-${testInfo.project.name}.png`;
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach("workspace-visual", { path, contentType: "image/png" });
}

for (const role of ["CANDIDATE", "RECRUITER", "ADMIN"] as const) {
  for (const view of ["overview", "notifications"] as const) {
    test(`${role} ${view} shares shell, typography, controls and keyboard navigation`, async ({ page }, testInfo) => {
      const destination = view === "overview" ? dashboards[role] : "/notifications";
      await fixtureSession(page, role, destination);
      if (view === "overview") await expect(page.locator(".metric").first()).toBeVisible();
      else await expect(page.getByRole("heading", { name: "Hồ sơ ứng tuyển đã được cập nhật", exact: true })).toBeVisible();
      await consistentWorkspace(page, destination);
      await saveScreenshot(page, role.toLowerCase() + (view === "notifications" ? "-notifications" : ""), testInfo);
      const target = view === "overview" ? "/notifications" : dashboards[role];
      const link = page.locator(`.workspace-navigation a[href="${target}"]`);
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(origin + target);
      await consistentWorkspace(page, target);
    });
  }
}

for (const [name, destination, heading] of [
  ["candidate-profile", "/candidate/profile", "Hồ sơ cá nhân"],
  ["candidate-cvs", "/candidate/profile/cvs", "CV của tôi"],
] as const) {
  test(`${name} uses the shared content and form geometry`, async ({ page }, testInfo) => {
    await fixtureSession(page, "CANDIDATE", destination);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (name === "candidate-profile") await expect(page.getByRole("heading", { name: "Nguyễn Minh Anh", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "CV Kỹ sư phần mềm", exact: true })).toBeVisible();
    await consistentWorkspace(page, destination);
    await saveScreenshot(page, name, testInfo);
  });
}


test("admin section controls update canonical navigation and survive reload", async ({ page }) => {
  await fixtureSession(page, "ADMIN", "/admin/users");
  await expect(page.getByRole("heading", { name: "Người dùng", exact: true })).toBeVisible();
  await page.route(api + "/auth/me", route => reply(route, { id: accountId, email: "workspace@example.test", role: "ADMIN" }));
  const controls = page.getByRole("navigation", { name: "Chức năng quản trị" });
  await controls.getByRole("button", { name: "Duyệt tin", exact: true }).click();
  await expect(page).toHaveURL(origin + "/admin/jobs");
  await expect(page.getByRole("heading", { name: "Duyệt tin", exact: true })).toBeVisible();
  await expect(page.locator('.workspace-navigation [aria-current="page"]')).toHaveAttribute("href", "/admin/jobs");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Duyệt tin", exact: true })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Duyệt tin", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.workspace-navigation [aria-current="page"]')).toHaveAttribute("href", "/admin/jobs");
  await controls.getByRole("button", { name: "Nhật ký", exact: true }).click();
  await expect(page).toHaveURL(origin + "/admin?tab=audit");
  await expect(page.getByRole("heading", { name: "Nhật ký", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nhật ký", exact: true })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Nhật ký", exact: true })).toHaveAttribute("aria-current", "page");
  await controls.getByRole("button", { name: "Thống kê", exact: true }).click();
  await expect(page).toHaveURL(origin + "/admin");
  await expect(page.getByRole("heading", { name: "Tổng quan hệ thống", exact: true })).toBeVisible();
});
