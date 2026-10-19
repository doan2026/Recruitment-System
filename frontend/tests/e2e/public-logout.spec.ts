import { expect, test, type Route } from "@playwright/test";

const api = "http://127.0.0.1:4173/api";
const userId = "1795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({
  status, contentType: "application/json", body: JSON.stringify(status < 400 ? { data, meta: null } : data),
});

for (const role of ["RECRUITER", "ADMIN"] as const) {
  for (const status of [204, 502]) {
    test(`${role} logout from public jobs keeps its portal after local-session reset and HTTP ${status}`, async ({ page }) => {
      await page.route(api + "/auth/me", route => reply(route, { id: userId, email: "logout@example.test", role }));
      await page.route(api + "/auth-cookie/refresh", route => reply(route, { code: "AUTH_INVALID" }, 401));
      await page.route(api + "/notifications**", route => reply(route, route.request().url().includes("unread-count") ? { unread_count: 0 } : []));
      await page.route(api + "/jobs/search**", route => reply(route, { items: [], total: 0, page: 1, limit: 10, source: "POSTGRESQL", hasMore: false, nextCursor: null }));
      let release!: () => void;
      const responseGate = new Promise<void>(resolve => { release = resolve; });
      let logouts = 0;
      await page.route(api + "/auth-cookie/logout", async route => {
        logouts++;
        await responseGate;
        if (status === 204) await route.fulfill({ status });
        else await reply(route, { code: "AUTH_LOGOUT_FAILED" }, status);
      });
      await page.goto("/candidate/jobs");
      await expect(page.locator(".public-shell")).toBeVisible();
      await expect(page.locator(".workspace-shell")).toHaveCount(0);
      try {
        await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
        // signOut clears local identity before the response, remounting this public route.
        await expect(page.getByRole("button", { name: "Đăng xuất", exact: true })).toHaveCount(0);
        await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
        await expect(page).toHaveURL(/\/candidate\/jobs$/);
        await expect.poll(() => logouts).toBe(1);
      } finally { release(); }
      const portal = role === "ADMIN" ? "/admin/login" : "/recruiter/login";
      await expect(page).toHaveURL("http://127.0.0.1:4173" + portal + (status === 204 ? "" : "?logout=unconfirmed"));
      await expect(page.getByRole("heading", { name: role === "ADMIN" ? "Đăng nhập quản trị" : "Đăng nhập Recruiter", exact: true })).toBeVisible();
      if (status === 502) await expect(page.locator("form p[role=alert]")).toContainText("máy chủ chưa xác nhận thu hồi");
      else await expect(page.locator("form p[role=alert]")).toHaveCount(0);
      expect(logouts).toBe(1);
    });
  }
}
