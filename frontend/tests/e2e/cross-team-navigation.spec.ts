import { expect, test, type Page, type Route } from "@playwright/test";
import { openWorkspaceMenu } from "./helpers/workspace";

const accountId = "1795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const targetId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const api = "http://127.0.0.1:4173/api";
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({
  status, contentType: "application/json", body: JSON.stringify(status < 400 ? { data, meta: null } : data),
});

async function session(page: Page, role?: "CANDIDATE" | "RECRUITER") {
  await page.route(api + "/auth/me", r => role ? reply(r, { id: accountId, email: "flow@example.test", role }) : reply(r, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/refresh", r => reply(r, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/notifications**", r => reply(r, r.request().url().includes("unread-count") ? { unread_count: 0 } : []));
  await page.route(api + "/profile/" + accountId, r => reply(r, { fullName: "Ứng viên kiểm thử" }));
  await page.route(api + "/chat/chats", r => reply(r, []));
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

test("Recruiter auth screens are independent of the private workspace", async ({ page }) => {
  await session(page);
  for (const route of ["/recruiter/login", "/recruiter/register"]) {
    await page.goto(route);
    await expect(page.locator("form")).toBeVisible();
    await expect(page.locator(".recruiter-sidebar")).toHaveCount(0);
    await expect(page.locator(".recruiter-shell")).toHaveCount(0);
    await noPageOverflow(page);
  }
});

test("Recruiter access recovery keeps invitation context and navigation", async ({ page }) => {
  await session(page);
  await page.goto("/recruiter/invitations/accept?source=invitation");
  await expect(page.getByRole("heading", { name: "Đăng nhập để tiếp tục" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Đăng nhập", exact: true }).last()).toHaveAttribute("href", "/recruiter/login?returnTo=%2Frecruiter%2Finvitations%2Faccept%3Fsource%3Dinvitation");
  await expect(page.locator(".workspace-header")).toBeVisible();
  await noPageOverflow(page);
});

test("Candidate messages and notifications keep one consistent workspace", async ({ page }, info) => {
  await session(page, "CANDIDATE");
  await page.goto("/messages");
  await openWorkspaceMenu(page);
  await expect(page.getByRole("navigation", { name: "Khu vực ứng viên" })).toHaveCount(1);
  await expect(page.locator(".candidate-workspace")).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Khu vực ứng viên"] a[href="/candidate/messages"]')).toHaveAttribute("aria-current", "page");
  await noPageOverflow(page);
  await openWorkspaceMenu(page);
  await page.locator('nav[aria-label="Khu vực ứng viên"] a[href="/candidate/notifications"]').click();
  await expect(page.getByRole("heading", { name: "Thông báo", exact: true })).toBeVisible();
  await expect(page.locator(".candidate-workspace")).toHaveCount(1);
  await noPageOverflow(page);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: `/tmp/recruitment-fe-candidate-${info.project.name}.png`, fullPage: true });
});

test("Report validation retains the job context and sends only a valid report", async ({ page }) => {
  await session(page, "CANDIDATE");
  const writes: unknown[] = [];
  await page.route(api + "/admin/reports", r => { writes.push(r.request().postDataJSON()); return reply(r, { id: targetId }); });
  await page.goto(`/reports?type=JOB&id=${targetId}`);
  await expect(page.getByLabel("Mã đối tượng")).toHaveValue(targetId);
  await page.getByRole("button", { name: "Gửi báo cáo", exact: true }).click();
  expect(writes).toHaveLength(0);
  await expect(page.locator("form p[role=alert]")).toContainText("Lý do");
  await page.getByLabel("Lý do", { exact: true }).fill("Thông tin tuyển dụng không chính xác");
  await page.getByRole("button", { name: "Gửi báo cáo", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Báo cáo đã được ghi nhận");
  expect(writes).toEqual([{ targetType: "JOB", targetId, reason: "Thông tin tuyển dụng không chính xác", description: "" }]);
  await noPageOverflow(page);
});

test("Recruiter notifications use a responsive sidebar with an active destination", async ({ page }, info) => {
  await session(page, "RECRUITER");
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Thông báo", exact: true })).toBeVisible();
  await openWorkspaceMenu(page);
  const nav = page.getByRole("navigation", { name: "Khu vực nhà tuyển dụng" });
  await expect(nav.getByRole("link", { name: "Thông báo", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".candidate-sidebar")).toHaveCount(0);
  await noPageOverflow(page);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: `/tmp/recruitment-fe-recruiter-${info.project.name}.png`, fullPage: true });
});

test("Homepage directs visitors into job discovery and the recruiter portal", async ({ page }, info) => {
  await session(page);
  await page.route(api + "/jobs**", r => reply(r, [], 200));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Công việc phù hợp");
  await noPageOverflow(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `/tmp/recruitment-ui-after-home-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Tìm việc", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Việc làm công khai" })).toBeVisible();
  await expect(page.locator(".workspace-sidebar")).toHaveCount(0);
  await page.getByRole("link", { name: "CareerHub - Trang chủ" }).click();
  await page.locator(".public-footer").getByRole("link", { name: "Nhà tuyển dụng", exact: true }).click();
  await expect(page).toHaveURL(/\/recruiter$/);
  await page.locator('header').getByRole("link", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByLabel("Email công việc", { exact: true })).toBeVisible();
  await noPageOverflow(page);
});

test("Candidate can reach general reporting from the workspace on every viewport", async ({ page }) => {
  await session(page, "CANDIDATE");
  await page.goto("/notifications");
  await openWorkspaceMenu(page);
  const nav = page.getByRole("navigation", { name: "Khu vực ứng viên" });
  const report = nav.getByRole("link", { name: "Báo cáo vi phạm", exact: true });
  await report.focus();
  await expect(report).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/candidate\/reports$/);
  await expect(page.getByRole("heading", { name: "Báo cáo vi phạm", exact: true })).toBeVisible();
  await openWorkspaceMenu(page);
  await expect(nav.getByRole("link", { name: "Báo cáo vi phạm", exact: true })).toHaveAttribute("aria-current", "page");
  await noPageOverflow(page);
});
