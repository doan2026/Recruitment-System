import { expect, test, type Page, type Route } from "@playwright/test";

const gateway = "http://127.0.0.1:4174";
const companyId = "3795c0de-7908-4ab5-9bed-4c4f1cf9c212";
const accountId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c213";
const baseCompany = {
  id: companyId, name: "Công ty Sản phẩm Việt", slug: "san-pham-viet", taxCode: "0012345678",
  description: "Mô tả ban đầu.\nDòng thứ hai.", industry: "Công nghệ", size: "51–200",
  address: "Hà Nội", website: "https://example.vn", verifiedStatus: "PENDING",
  aggregateVersion: 7, rejectReason: null,
  logo: { fileId: "5795c0de-7908-4ab5-9bed-4c4f1cf9c214", url: "https://example.vn/logo.png" },
  media: [],
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
};

function reply(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:4173", "access-control-allow-credentials": "true" },
    body: JSON.stringify(status >= 400 ? data : { data, meta: null }),
  });
}

async function openCompany(page: Page, options: { verified?: boolean; conflictFirstSave?: boolean } = {}) {
  let current: Record<string, unknown> = { ...baseCompany, verifiedStatus: options.verified ? "VERIFIED" : "PENDING" };
  const writes: Record<string, unknown>[] = [];
  let reads = 0;
  let injectConflict = options.conflictFirstSave ?? false;
  await page.route(`${gateway}/companies/me`, (route) => { reads += 1; return reply(route, current); });
  await page.route(`${gateway}/companies/by-user/${accountId}`, (route) => reply(route, {
    companyId, name: baseCompany.name, verifiedStatus: current.verifiedStatus, memberRole: "OWNER",
  }));
  await page.route(`${gateway}/companies/${companyId}/members`, (route) => reply(route, [
    { userId: accountId, role: "OWNER", joinedAt: "2026-09-01T00:00:00Z" },
  ]));
  await page.route(`${gateway}/companies/${companyId}`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push(body);
    if (injectConflict && "name" in body) {
      injectConflict = false;
      current = { ...current, aggregateVersion: Number(current.aggregateVersion) + 1,
        name: "Công ty bản máy chủ", taxCode: "0088", description: "Mô tả từ máy chủ",
        industry: "Tài chính", size: "501+", address: "Đà Nẵng", website: "https://server.example.vn" };
    }
    if (body.expectedVersion !== current.aggregateVersion) {
      return reply(route, { code: "COMPANY_UPDATE_CONFLICT", message: "Company changed" }, 409);
    }
    const legalChanged = ("name" in body && body.name !== current.name) || ("taxCode" in body && body.taxCode !== current.taxCode);
    current = { ...current, ...body, aggregateVersion: Number(current.aggregateVersion) + 1,
      verifiedStatus: current.verifiedStatus === "VERIFIED" && legalChanged ? "PENDING" : current.verifiedStatus,
      logo: body.removeLogo ? null : current.logo };
    return reply(route, current);
  });
  await page.route(`${gateway}/auth/login`, (route) => reply(route, {
    accessToken: "company-edit-contract-access", refreshToken: "company-edit-contract-refresh",
    tokenType: "Bearer", user: { id: accountId, role: "RECRUITER", email: "fixture@example.com" },
  }));
  await page.goto("/login?returnTo=%2Frecruiter%2Fcompany");
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("button", { name: "Chỉnh sửa hồ sơ", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Chỉnh sửa hồ sơ", exact: true }).click();
  return { writes, reads: () => reads };
}

test("company profile validates and saves all fields with the loaded version and nullable website", async ({ page }) => {
  const state = await openCompany(page);
  await expect(page.getByLabel("Mô tả công ty", { exact: true })).toHaveValue(baseCompany.description);
  await expect(page.getByLabel("Lĩnh vực", { exact: true })).toHaveValue(baseCompany.industry);
  await page.getByLabel("Mô tả công ty", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByText("Nhập mô tả.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Mô tả công ty", { exact: true })).toBeFocused();
  expect(state.writes).toHaveLength(0);
  await page.getByLabel("Tên công ty", { exact: true }).fill("Công ty tên mới");
  await page.getByLabel("Mã số thuế", { exact: true }).fill("00099");
  await page.getByLabel("Mô tả công ty", { exact: true }).fill("Mô tả mới\nGiữ nguyên xuống dòng.");
  await page.getByLabel("Lĩnh vực", { exact: true }).fill("Sản phẩm");
  await page.getByLabel("Quy mô", { exact: true }).fill("201–500");
  await page.getByLabel("Địa chỉ", { exact: true }).fill("Thành phố Hồ Chí Minh");
  await page.getByLabel("Website (không bắt buộc)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByText("Đã lưu thông tin công ty.", { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{
    name: "Công ty tên mới", taxCode: "00099", description: "Mô tả mới\nGiữ nguyên xuống dòng.",
    industry: "Sản phẩm", size: "201–500", address: "Thành phố Hồ Chí Minh", website: null, expectedVersion: 7,
  }]);
  await expect(page.getByText("Mô tả mới Giữ nguyên xuống dòng.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("verified legal edit confirms once and preserves nonlegal fields through the dialog", async ({ page }) => {
  const state = await openCompany(page, { verified: true });
  await page.getByLabel("Tên công ty", { exact: true }).fill("Tên pháp lý mới");
  await page.getByLabel("Mô tả công ty", { exact: true }).fill("Mô tả kèm thay đổi pháp lý");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Thay đổi này cần xác minh lại" });
  await expect(dialog).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(page.getByLabel("Mô tả công ty", { exact: true })).toHaveValue("Mô tả kèm thay đổi pháp lý");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await dialog.getByRole("button", { name: "Xác nhận và lưu", exact: true }).click();
  await expect(page.getByText("Thông tin pháp lý đã đổi. Hồ sơ được chuyển về chờ xác minh.", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ name: "Tên pháp lý mới", description: "Mô tả kèm thay đổi pháp lý", expectedVersion: 7 });
});

test("company 409 compares seven fields then explicitly rebases the full kept draft without automatic retry", async ({ page }) => {
  const state = await openCompany(page, { conflictFirstSave: true });
  const initialReads = state.reads();
  await page.getByLabel("Mô tả công ty", { exact: true }).fill("Bản nháp của tôi");
  await page.getByLabel("Địa chỉ", { exact: true }).fill("Địa chỉ của tôi");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  const conflict = page.locator(".conflict-panel");
  await expect(conflict).toBeVisible();
  await expect(conflict.locator("tbody tr")).toHaveCount(7);
  await expect(conflict).toContainText("Mô tả từ máy chủ");
  await expect(conflict).toContainText("Bản nháp của tôi");
  expect(state.writes).toHaveLength(1);
  expect(state.reads()).toBe(initialReads + 1);
  await conflict.getByRole("button", { name: "Giữ bản tôi vừa nhập", exact: true }).click();
  expect(state.writes).toHaveLength(1);
  await expect(page.getByLabel("Mô tả công ty", { exact: true })).toHaveValue("Bản nháp của tôi");
  await expect(page.getByLabel("Địa chỉ", { exact: true })).toHaveValue("Địa chỉ của tôi");
  await expect(page.getByLabel("Lĩnh vực", { exact: true })).toHaveValue(baseCompany.industry);
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByText("Đã lưu thông tin công ty.", { exact: true })).toBeVisible();
  expect(state.writes[1]).toMatchObject({ expectedVersion: 8, description: "Bản nháp của tôi", address: "Địa chỉ của tôi", industry: baseCompany.industry });
});

test("media update cannot erase the active company draft or silently advance its version", async ({ page }) => {
  const state = await openCompany(page);
  await page.getByLabel("Mô tả công ty", { exact: true }).fill("Mô tả chưa lưu khi xóa logo");
  await page.getByRole("button", { name: "Xóa logo khi lưu", exact: true }).click();
  await page.getByRole("button", { name: "Lưu toàn bộ thư viện", exact: true }).click();
  await expect(page.getByText("Đã lưu toàn bộ thứ tự và nội dung thư viện.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Mô tả công ty", { exact: true })).toHaveValue("Mô tả chưa lưu khi xóa logo");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  const conflict = page.locator(".conflict-panel");
  await expect(conflict).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toMatchObject({ removeLogo: true, expectedVersion: 7 });
  expect(state.writes[1]).toMatchObject({ description: "Mô tả chưa lưu khi xóa logo", expectedVersion: 7 });
  await conflict.getByRole("button", { name: "Dùng dữ liệu mới nhất", exact: true }).click();
  await expect(page.getByLabel("Mô tả công ty", { exact: true })).toHaveValue(baseCompany.description);
  expect(state.writes).toHaveLength(2);
});

test("closing a dirty company form asks before discarding the full draft", async ({ page }) => {
  const state = await openCompany(page);
  await page.getByLabel("Địa chỉ", { exact: true }).fill("Địa chỉ chưa lưu");
  await page.getByRole("button", { name: "Đóng chỉnh sửa", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Bỏ các thay đổi chưa lưu?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(page.getByLabel("Địa chỉ", { exact: true })).toHaveValue("Địa chỉ chưa lưu");
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await dialog.getByRole("button", { name: "Bỏ thay đổi", exact: true }).click();
  await expect(page.getByRole("button", { name: "Chỉnh sửa hồ sơ", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Chỉnh sửa hồ sơ", exact: true }).click();
  await expect(page.getByLabel("Địa chỉ", { exact: true })).toHaveValue(baseCompany.address);
  expect(state.writes).toHaveLength(0);
});
