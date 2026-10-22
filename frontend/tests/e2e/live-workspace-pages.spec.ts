import { expect, test, type Page, type Route } from "@playwright/test";

const api = "http://127.0.0.1:4173/api";
const userId = "1795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const cvId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({ status,
  contentType: "application/json", body: JSON.stringify(status < 400 ? { data, meta: null } : data) });

async function login(page: Page, role: "CANDIDATE" | "ADMIN", destination: string) {
  await page.route(api + "/auth/me", r => reply(r, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/refresh", r => reply(r, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/notifications**", r => reply(r, r.request().url().includes("unread-count") ? { unread_count: 0 } : []));
  await page.route(api + "/profile/" + userId, r => reply(r, { fullName: "Workspace Fixture" }));
  await page.route(api + "/auth-cookie/login", r => reply(r, { user: { id: userId, email: "fixture@example.test", role } }));
  await page.goto((role === "ADMIN" ? "/admin/login" : "/login") + "?returnTo=" + encodeURIComponent(destination));
  await page.getByLabel(role === "ADMIN" ? "Email quản trị" : "Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("FixturePassword123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4173" + destination);
}

for (const [tab, resource, title, row] of [
  ["users", "users", "Người dùng", { id: userId, email: "directory-fixture@example.test", role: "CANDIDATE", is_verified: true }],
  ["companies", "companies/pending", "Duyệt công ty", { id: userId, name: "Pending company fixture", description: "Review company" }],
  ["jobs", "jobs/pending", "Duyệt tin", { id: userId, title: "Pending job fixture", description: "Review job" }],
  ["reports", "reports", "Báo cáo vi phạm", { id: userId, reason: "Report fixture", description: "Stored report body", status: "OPEN", target_type: "USER", target_id: cvId, version: 1 }],
] as const) {
  test(`Admin ${tab} route reads its real API contract instead of static examples`, async ({ page }) => {
    let reads = 0;
    await page.route(api + "/admin/" + resource + "**", r => { reads++; return reply(r, [row]); });
    await login(page, "ADMIN", "/admin/" + tab);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /fixture/ }).first()).toBeVisible();
    expect(reads).toBeGreaterThan(0);
    await expect(page.getByText("Nguyễn Văn A", { exact: true })).toHaveCount(0);
  });
}

test("Candidate dashboard uses owned totals and marks a truncated interview page", async ({ page }) => {
  await page.route(api + "/applications/bookmarks", r => reply(r, [
    { id: cvId, jobId: cvId, createdAt: "2026-10-01T00:00:00Z", job: null },
  ]));
  await page.route(api + "/applications/my", r => reply(r, [
    { id: cvId, jobId: cvId, candidateId: userId, status: "APPLIED", appliedAt: "2026-10-01T00:00:00Z" },
  ]));
  await page.route(api + "/interviews/my**", r => {
    expect(new URL(r.request().url()).searchParams.get("period")).toBe("UPCOMING");
    return reply(r, { items: Array.from({ length: 20 }, () => ({})), nextCursor: "opaque-next" });
  });
  await login(page, "CANDIDATE", "/candidate/dashboard");
  const cards = page.getByRole("region", { name: "Thống kê của tôi" });
  await expect(cards.getByRole("link", { name: "Việc đã lưu 1", exact: true })).toBeVisible();
  await expect(cards.getByRole("link", { name: "Hồ sơ đã nộp 1", exact: true })).toBeVisible();
  await expect(cards.getByRole("link", { name: "Phỏng vấn sắp tới 20+", exact: true })).toBeVisible();
});

test("CV detail reads owned metadata and refuses a non-HTTPS download URL", async ({ page }) => {
  await page.route(api + "/profile/cvs/" + cvId, r => reply(r, { id: cvId, title: "Stored private CV",
    type: "UPLOAD", revisionNumber: 3, aggregateVersion: 4, isDefault: true }));
  await page.route(api + "/profile/cvs/" + cvId + "/download-url", r => reply(r, { url: "javascript:alert(1)" }));
  await login(page, "CANDIDATE", "/candidate/cvs/" + cvId);
  await expect(page.getByRole("heading", { name: "Stored private CV" })).toBeVisible();
  await expect(page.getByText(/Phiên bản 3/)).toBeVisible();
  await page.getByRole("button", { name: "Tải xuống PDF" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Liên kết tải không hợp lệ");
  await expect(page.getByText(/85\/100/)).toHaveCount(0);
});

test("Legacy CV creation opens the functional builder", async ({ page }) => {
  await login(page, "CANDIDATE", "/candidate/profile");
  await page.route(api + "/auth/me", r => reply(r, { id: userId, email: "fixture@example.test", role: "CANDIDATE" }));
  await page.goto("/candidate/cvs/new");
  await expect(page).toHaveURL(/\/candidate\/profile\/cvs\/builder$/);
});

test("AI practice clearly states availability and offers the actual interview calendar", async ({ page }) => {
  await login(page, "CANDIDATE", "/candidate/ai/interview");
  await expect(page.getByRole("heading", { name: "Luyện tập phỏng vấn chưa được mở" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Xem lịch phỏng vấn" })).toHaveAttribute("href", "/candidate/interviews");
  await expect(page.getByRole("button", { name: "Gửi trả lời" })).toHaveCount(0);
});

for (const status of [204, 502]) {
  test(`Admin can leave the workspace; logout HTTP ${status} reports revocation accurately`, async ({ page }) => {
    await page.route(api + "/admin/users**", r => reply(r, []));
    await page.route(api + "/auth-cookie/logout", r => status === 204
      ? r.fulfill({ status }) : reply(r, { code: "AUTH_LOGOUT_FAILED" }, status));
    await login(page, "ADMIN", "/admin/users");
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await expect(page).toHaveURL(status === 204 ? /\/admin\/login$/ : /\/admin\/login\?logout=unconfirmed$/);
    await expect(page.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();
    if (status !== 204) await expect(page.locator("p[role=alert]")).toContainText("máy chủ chưa xác nhận thu hồi");
  });
}
