import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
const api = "http://127.0.0.1:4174";
const userId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c213";
const cvId = "7795c0de-7908-4ab5-9bed-4c4f1cf9c216";
const fileId = "8795c0de-7908-4ab5-9bed-4c4f1cf9c217";
const headers = {
  "content-type": "application/json",
  "access-control-allow-origin": "http://127.0.0.1:4173",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};
async function reply(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    headers,
    body: JSON.stringify(status >= 400 ? data : { data, meta: {} }),
  });
}
const profile = {
  userId,
  fullName: "Nguyễn Văn An",
  headline: "Lập trình viên",
  summary: "Kinh nghiệm TypeScript",
  phone: "0901234567",
  address: "Hà Nội",
  githubUrl: null,
  linkedinUrl: null,
  portfolioUrl: null,
  avatarUrl: null,
  completionPercent: 40,
  missingSections: ["educations"],
  educations: [],
  experiences: [],
  skills: [],
  certificates: [],
  projects: [],
};
const tokens = (role = "CANDIDATE") => ({
  accessToken: "access",
  refreshToken: "refresh",
  tokenType: "Bearer",
  user: { id: userId, email: "candidate@example.com", role },
});
async function base(page: Page) {
  await page.route(api + "/**", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers })
      : reply(route, { code: "UNEXPECTED_REQUEST" }, 500),
  );
  await page.route(api + "/profile/" + userId, (route) =>
    reply(route, profile),
  );
}
async function login(
  page: Page,
  role = "CANDIDATE",
  path = "/candidate/profile",
  returnTo = path,
) {
  await page.route(api + "/auth/login", (route) => reply(route, tokens(role)));
  const portal = role === "ADMIN" ? "/admin/login" : role === "RECRUITER" ? "/recruiter/login" : "/login";
  await page.goto(portal + "?returnTo=" + encodeURIComponent(returnTo));
  await page.getByLabel(role === "ADMIN" ? "Email quản trị" : role === "RECRUITER" ? "Email công việc" : "Email", { exact: true }).fill("candidate@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Password123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(path.replaceAll("/", "\\/") + "$"));
}
test("registration keeps flow identity and OTP signs in without persisting tokens", async ({
  page,
}) => {
  await base(page);
  const flow = "3795c0de-7908-4ab5-9bed-4c4f1cf9c212";
  let verified: unknown;
  await page.route(api + "/auth/register", (route) =>
    reply(route, { registrationId: flow, expiresInSeconds: 300 }, 202),
  );
  await page.route(api + "/auth/otp/verify", (route) => {
    verified = route.request().postDataJSON();
    return reply(route, tokens());
  });
  await page.goto("/register");
  await page.getByLabel("Họ tên", { exact: true }).fill("Nguyễn Văn An");
  await page.getByLabel("Email", { exact: true }).fill("candidate@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Password123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Password123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await page.getByLabel("Mã xác minh").fill("123456");
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hồ sơ cá nhân", exact: true }),
  ).toBeVisible();
  expect(verified).toEqual({
    email: "candidate@example.com",
    registrationId: flow,
    otp: "123456",
  });
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
test("reset reads a one-time fragment once under StrictMode and clears it from URL", async ({
  page,
}) => {
  await base(page);
  let body: unknown;
  await page.route(api + "/auth/reset-password", (route) => {
    body = route.request().postDataJSON();
    return reply(route, {});
  });
  await page.goto("/reset-password#token=pr1_test-token");
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill("NewPassword123");
  await page.getByLabel("Nhập lại mật khẩu").fill("NewPassword123");
  await page.getByRole("button", { name: "Lưu mật khẩu" }).click();
  await expect(page.getByRole("status")).toContainText("đã được cập nhật");
  expect(page.url()).not.toContain("token");
  expect(body).toEqual({
    token: "pr1_test-token",
    newPassword: "NewPassword123",
  });
});
for (const role of ["CANDIDATE", "RECRUITER"] as const) {
test(`Google automatically signs in to ${role} with the HttpOnly binder exactly once`, async ({
  page,
}) => {
  await base(page);
  await page.context().addCookies([{
    name: "oauth2_exchange_binder",
    value: "test-browser-binder",
    domain: "127.0.0.1",
    path: "/auth/google/exchange",
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
  }]);
  let count = 0;
  await page.route("http://127.0.0.1:4173/auth/google/exchange", async (route) => {
    count++;
    expect(await route.request().headerValue("cookie")).toContain("oauth2_exchange_binder=test-browser-binder");
    expect(route.request().postDataJSON()).toEqual({
      code: "one-time-google",
      role,
    });
    return reply(route, tokens(role));
  });
  await page.goto("/auth/callback#code=one-time-google&role=" + role);
  await expect(page).toHaveURL(role === "CANDIDATE" ? /\/candidate\/profile$/ : /\/recruiter\/jobs$/);
  if (role === "CANDIDATE") await expect(
    page.getByRole("heading", { name: "Hồ sơ cá nhân", exact: true }),
  ).toBeVisible();
  expect(count).toBe(1);
  expect(page.url()).not.toContain("code=");
  await expect(page.getByRole("combobox", { name: "Vai trò", exact: true })).toHaveCount(0);
});
}

for (const fragment of ["code=one-time-google", "code=one-time-google&role=ADMIN", "role=RECRUITER"]) {
test(`Google callback rejects incomplete or invalid portal metadata: ${fragment}`, async ({ page }) => {
  await base(page);
  let exchanges = 0;
  await page.route("http://127.0.0.1:4173/auth/google/exchange", route => { exchanges++; return reply(route, tokens()); });
  await page.goto("/auth/callback#" + fragment);
  await expect(page.getByRole("alert").filter({ hasText: "Hãy bắt đầu lại" })).toBeVisible();
  await expect(page).toHaveURL("http://127.0.0.1:4173/auth/callback");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  expect(exchanges).toBe(0);
});
}

test("Google role mismatch stays signed out, offers the original portal and never replays exchange", async ({ page }) => {
  await base(page);
  let exchanges = 0;
  await page.route("http://127.0.0.1:4173/auth/google/exchange", route => {
    exchanges++;
    return reply(route, { code: "GOOGLE_ROLE_MISMATCH" }, 403);
  });
  await page.goto("/auth/callback#code=one-time-google&role=RECRUITER");
  await expect(page.getByRole("alert").filter({ hasText: "thuộc vai trò khác" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quay lại đăng nhập", exact: true })).toHaveAttribute("href", "/recruiter/login");
  await expect(page.getByRole("button", { name: "Tiếp tục", exact: true })).toHaveCount(0);
  expect(exchanges).toBe(1);
  expect(page.url()).not.toContain("code=");
});
test("profile sections save independently with the current candidate identity", async ({
  page,
}) => {
  await base(page);
  let body: unknown;
  await page.route(api + "/profile/skills", (route) => {
    body = route.request().postDataJSON();
    return reply(route, {
      ...profile,
      completionPercent: 55,
      skills: [{ id: cvId, name: "TypeScript", level: "Tốt" }],
    });
  });
  await login(page);
  const section = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Kỹ năng", exact: true }),
    });
  await section.getByLabel("Tên kỹ năng").fill("TypeScript");
  await section.getByLabel("Mức độ").fill("Tốt");
  await section.getByRole("button", { name: "Lưu kỹ năng" }).click();
  await expect(page.getByRole("progressbar", { name: "Mức độ hoàn thiện hồ sơ" })).toHaveAttribute("value", "55");
  expect(body).toEqual({ name: "TypeScript", level: "Tốt" });
});
test("CV Builder exports Vietnamese PDF then publishes a private snapshot", async ({
  page,
}) => {
  await base(page);
  let stored: Record<string, unknown> | undefined;
  await page.route(api + "/profile/cvs", (route) => reply(route, []));
  await page.route(api + "/files/signature", (route) =>
    reply(route, {
      fileId,
      uploadUrl: "https://api.cloudinary.com/v1_1/test/raw/upload",
      apiKey: "public-key",
      signature: "signature",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      maxBytes: 5242880,
      allowedFormats: ["pdf"],
      params: { timestamp: 1 },
    }),
  );
  await page.route("https://api.cloudinary.com/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    }),
  );
  await page.route(api + "/files/", (route) => {
    expect(route.request().postDataJSON()).toEqual({ fileId });
    return reply(route, { id: fileId, status: "ACTIVE" });
  });
  await page.route(api + "/profile/cvs/online", (route) => {
    stored = route.request().postDataJSON();
    return reply(route, { id: cvId });
  });
  await login(page, "CANDIDATE", "/candidate/profile/cvs/builder");
  await expect(
    page.getByRole("textbox", { name: "Họ tên", exact: true }),
  ).toHaveValue("Nguyễn Văn An", { timeout: 15000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất PDF", exact: true }).click();
  const downloaded = await download;
  const path = await downloaded.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(10000);
  await page.getByRole("button", { name: "Lưu CV", exact: true }).click();
  await expect(page).toHaveURL(/\/candidate\/profile\/cvs$/);
  expect(stored?.fileId).toBe(fileId);
  expect(stored?.contentSchemaVersion).toBe(1);
  expect((stored?.contentJson as Record<string, unknown>).fullName).toBe(
    "Nguyễn Văn An",
  );
});
test("CV delete carries version and explains deferred deletion", async ({
  page,
}) => {
  await base(page);
  let reads = 0;
  let sent: unknown;
  await page.route(api + "/profile/cvs", (route) =>
    reply(
      route,
      reads++
        ? []
        : [
            {
              id: cvId,
              title: "CV cũ",
              type: "UPLOAD",
              isDefault: true,
              aggregateVersion: 7,
              revisionNumber: 1,
              createdAt: "2026-08-01T00:00:00Z",
            },
          ],
    ),
  );
  await page.route(api + "/profile/cvs/" + cvId, (route) => {
    sent = route.request().postDataJSON();
    return reply(route, { deletionMode: "PENDING" }, 202);
  });
  await login(page, "CANDIDATE", "/candidate/profile/cvs");
  await page.getByRole("button", { name: "Xóa CV", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Xóa CV", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "đang kiểm tra tham chiếu" }),
  ).toBeVisible();
  expect(sent).toEqual({ expectedAggregateVersion: 7 });
});
test("candidate login cannot redirect into the admin portal or load admin data", async ({ page }) => {
  await base(page);
  let reads = 0;
  await page.route(api + "/admin/**", (route) => {
    reads++;
    return reply(route, {});
  });
  await login(page, "CANDIDATE", "/candidate/profile", "/admin");
  await expect(
    page.getByRole("heading", { name: "Hồ sơ cá nhân", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(0);
});
test("admin rejection requires reason and confirmation before one mutation", async ({
  page,
}) => {
  await base(page);
  let writes = 0;
  await page.route(api + "/admin/stats/overview**", (route) =>
    reply(route, { daily: [], totals: {} }),
  );
  await page.route(api + "/admin/stats/funnel**", (route) => reply(route, []));
  await page.route(api + "/admin/jobs/pending", (route) =>
    reply(route, [
      {
        id: cvId,
        title: "Tin cần duyệt",
        description: "Nội dung",
        deadline: "2027-01-01",
      },
    ]),
  );
  await page.route(api + "/admin/jobs/" + cvId + "/reject", (route) => {
    writes++;
    expect(route.request().postDataJSON()).toEqual({
      reason: "Nội dung không phù hợp",
    });
    return reply(route, {});
  });
  await login(page, "ADMIN", "/admin");
  await page.getByRole("button", { name: "Duyệt tin", exact: true }).click();
  await page.getByRole("button", { name: "Từ chối", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Nhập lý do" }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.getByLabel("Lý do / kết quả xử lý").fill("Nội dung không phù hợp");
  await page.getByRole("button", { name: "Từ chối", exact: true }).click();
  expect(writes).toBe(0);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Xác nhận", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã hoàn tất" }),
  ).toBeVisible();
  expect(writes).toBe(1);
});

test("registration validates identity and matching passwords before sending an OTP", async ({ page }) => {
  await base(page);
  let dispatches = 0;
  await page.route(api + "/auth/register", route => { dispatches++; return reply(route, {}, 202); });
  await page.goto("/register");
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "họ tên" })).toBeVisible();
  await page.getByLabel("Họ tên", { exact: true }).fill("Nguyễn An");
  await page.getByLabel("Email", { exact: true }).fill("candidate@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Password123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("OtherPassword123");
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "chưa trùng" })).toBeVisible();
  expect(dispatches).toBe(0);
});

test("Google registration links use the selected portal when enabled", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("link", { name: "Đăng ký với Google" })).toHaveAttribute("href", "/auth/google?role=CANDIDATE");
  await page.goto("/recruiter/register");
  await expect(page.getByRole("link", { name: "Đăng ký với Google" })).toHaveAttribute("href", "/auth/google?role=RECRUITER");
});

test("candidate portal rejects a recruiter session and logs it out", async ({ page }) => {
  await base(page);
  let logouts = 0;
  await page.route(api + "/auth/login", route => reply(route, tokens("RECRUITER")));
  await page.route(api + "/auth/logout", route => { logouts++; return reply(route, {}); });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("recruiter@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Password123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "dành cho ứng viên" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  expect(logouts).toBe(1);
});

test("recruiter registration saves contact in Auth and can retry after a temporary failure", async ({ page }) => {
  await base(page);
  let contacts = 0;
  let candidateWrites = 0;
  await page.route(api + "/profile/**", route => { candidateWrites++; return reply(route, {}, 403); });
  await page.route(api + "/auth/register", route => {
    expect(route.request().postDataJSON().role).toBe("RECRUITER");
    return reply(route, { registrationId: userId }, 202);
  });
  await page.route(api + "/auth/otp/verify", route => reply(route, tokens("RECRUITER")));
  await page.route(api + "/auth/me/recruiter-contact", route => {
    expect(route.request().postDataJSON()).toEqual({ fullName: "Nguyễn Recruiter", phone: "0901234567" });
    contacts++;
    return contacts === 1 ? reply(route, { code: "TEMPORARY_FAILURE" }, 503) : reply(route, {});
  });
  await page.goto("/recruiter/register");
  await page.getByLabel("Họ và tên", { exact: true }).fill("Nguyễn Recruiter");
  await page.getByLabel("Email công việc", { exact: true }).fill("recruiter@example.com");
  await page.getByLabel("Số điện thoại", { exact: true }).fill("0901234567");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Password123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Password123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await page.getByLabel("Mã xác minh OTP").fill("123456");
  await page.getByRole("button", { name: "Xác minh tài khoản", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tài khoản Recruiter đã xác minh" })).toBeVisible();
  expect(contacts).toBe(1);
  await page.getByRole("button", { name: "Lưu lại thông tin liên hệ" }).click();
  await expect(page).toHaveURL(/\/recruiter\/jobs$/);
  expect(contacts).toBe(2);
  expect(candidateWrites).toBe(0);
});

test("recruiter portal restores only its own remembered email", async ({ page }) => {
  await page.goto("/recruiter/login");
  await page.evaluate(() => {
    localStorage.setItem("careerhub.remembered-login-email:recruiter", "remembered@example.com");
    localStorage.setItem("careerhub.remembered-login-email:admin", "admin@example.com");
  });
  await page.reload();
  await expect(page.getByLabel("Email công việc", { exact: true })).toHaveValue("remembered@example.com");
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveValue("");
  await expect(page.getByRole("checkbox")).toBeChecked();
});
