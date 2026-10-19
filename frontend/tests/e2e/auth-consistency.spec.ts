import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

const api = "http://127.0.0.1:4173/api";
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({
  status, contentType: "application/json", body: JSON.stringify(status < 400 ? { data, meta: null } : data),
});

async function anonymousSession(page: Page) {
  await page.route(api + "/auth/me", route => reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/refresh", route => reply(route, { code: "AUTH_INVALID" }, 401));
}

async function frameGeometry(page: Page) {
  await expect(page.locator("[data-auth-frame]")).toHaveCount(1);
  await expect(page.locator("[data-auth-frame] h1")).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  return page.locator("[data-auth-frame]").evaluate(frame => {
    const card = frame.querySelector("section")!;
    const heading = card.querySelector("h1")!;
    const brand = frame.querySelector("header a")!;
    const input = card.querySelector<HTMLInputElement>(".auth-field input");
    const submit = card.querySelector<HTMLButtonElement>("button[type=submit]");
    const cardStyle = getComputedStyle(card);
    const headingStyle = getComputedStyle(heading);
    return {
      cardWidth: card.getBoundingClientRect().width,
      cardLeft: card.getBoundingClientRect().left,
      cardPadding: cardStyle.padding,
      cardRadius: cardStyle.borderRadius,
      cardBackground: cardStyle.backgroundColor,
      cardBorder: cardStyle.borderColor,
      headingSize: headingStyle.fontSize,
      headingFamily: headingStyle.fontFamily,
      headingLineHeight: headingStyle.lineHeight,
      inputHeight: input?.getBoundingClientRect().height ?? null,
      inputWidth: input?.getBoundingClientRect().width ?? null,
      inputRadius: input ? getComputedStyle(input).borderRadius : null,
      submitHeight: submit?.getBoundingClientRect().height ?? null,
      submitColor: submit ? getComputedStyle(submit).backgroundColor : null,
      brandColor: getComputedStyle(brand).color,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

type Geometry = Awaited<ReturnType<typeof frameGeometry>>;
function expectSameFamily(actual: Geometry, baseline: Geometry, controls = true) {
  expect(actual.overflow).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.cardWidth - baseline.cardWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.cardLeft - baseline.cardLeft)).toBeLessThanOrEqual(1);
  for (const key of ["cardPadding", "cardRadius", "cardBackground", "cardBorder", "headingSize", "headingFamily", "headingLineHeight", "brandColor"] as const) {
    expect(actual[key], `Shared auth style: ${key}`).toBe(baseline[key]);
  }
  if (controls) {
    expect(actual.inputHeight).not.toBeNull();
    expect(actual.submitHeight).not.toBeNull();
    expect(actual.inputHeight!).toBeGreaterThanOrEqual(44);
    expect(actual.submitHeight!).toBeGreaterThanOrEqual(44);
    expect(Math.abs(actual.inputHeight! - baseline.inputHeight!)).toBeLessThanOrEqual(1);
    expect(Math.abs(actual.inputWidth! - baseline.inputWidth!)).toBeLessThanOrEqual(1);
    expect(Math.abs(actual.submitHeight! - baseline.submitHeight!)).toBeLessThanOrEqual(1);
    expect(actual.inputRadius).toBe(baseline.inputRadius);
    expect(actual.submitColor).toBe(actual.brandColor);
  }
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`auth-${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(`Auth family · ${name}`, { path, contentType: "image/png" });
}

test("Candidate, Recruiter and Admin login share brand, heading and control geometry", async ({ page }, info) => {
  await anonymousSession(page);
  let baseline: Geometry | undefined;
  for (const [path, portal, emailLabel] of [
    ["/login", "candidate", "Email"],
    ["/recruiter/login", "recruiter", "Email công việc"],
    ["/admin/login", "admin", "Email quản trị"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("[data-auth-frame]")).toHaveAttribute("data-auth-frame", portal);
    await expect(page.getByLabel(emailLabel, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Chọn khu vực đăng nhập" }).locator('[aria-current="page"]')).toHaveCount(1);
    const geometry = await frameGeometry(page);
    baseline ??= geometry;
    expectSameFamily(geometry, baseline);
    await screenshot(page, info, `${portal}-login`);
  }
});

test("Registration and password recovery retain the same responsive auth family", async ({ page }, info) => {
  await anonymousSession(page);
  await page.goto("/login");
  const baseline = await frameGeometry(page);
  for (const [path, name, portal] of [
    ["/register", "candidate-register", "candidate"],
    ["/recruiter/register", "recruiter-register", "recruiter"],
    ["/forgot-password", "candidate-recovery", "candidate"],
    ["/forgot-password?role=RECRUITER", "recruiter-recovery", "recruiter"],
    ["/forgot-password?role=ADMIN", "admin-recovery", "admin"],
    ["/reset-password#token=visual-fixture", "reset-password", "candidate"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("[data-auth-frame]")).toHaveAttribute("data-auth-frame", portal);
    expectSameFamily(await frameGeometry(page), baseline);
    await screenshot(page, info, name);
  }
});

test("Google callback failure keeps the shared frame and a visible recovery action", async ({ page }, info) => {
  await anonymousSession(page);
  await page.goto("/login");
  const baseline = await frameGeometry(page);
  let exchanges = 0;
  await page.route("**/auth/google/exchange", route => { exchanges++; return reply(route, {}, 500); });
  await page.goto("/auth/callback#role=CANDIDATE");
  await expect(page.locator("[data-auth-frame] p[role=alert]")).toContainText("Hãy bắt đầu lại");
  await expect(page.getByRole("link", { name: "Quay lại đăng nhập", exact: true })).toHaveAttribute("href", "/login");
  expectSameFamily(await frameGeometry(page), baseline, false);
  expect(exchanges).toBe(0);
  await screenshot(page, info, "google-callback-recovery");
});
