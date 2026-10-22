import { expect, test, type Page, type Route } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { openWorkspaceMenu } from "./helpers/workspace";

const api = "http://127.0.0.1:4173/api";
const companyId = "3795c0de-7908-4ab5-9bed-4c4f1cf9c212";
const otherId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c213";
const userId = "1795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const jobId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const company = {
  id: companyId, name: "Công ty Sản phẩm Việt", slug: "san-pham-viet", description: "Đội ngũ phát triển sản phẩm công nghệ cho thị trường Việt Nam.",
  industry: "Công nghệ thông tin", size: "51-200", address: "Hà Nội", website: "https://example.test", taxCode: "0101234567", logoUrl: null, media: [],
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z",
};
const job = {
  id: jobId, companyId, companyName: company.name, title: "Kỹ sư sản phẩm", description: "Phát triển nền tảng tuyển dụng.",
  salaryMin: "20000000", salaryMax: "35000000", isNegotiable: false, currency: "VND", jobType: "FULL_TIME", location: "Hà Nội",
  experienceYears: 2, skills: ["TypeScript"], deadline: "2099-12-31", status: "PUBLISHED", requirements: "TypeScript", benefits: "Bảo hiểm", aggregateVersion: 1,
};
let server: Server;
const reply = (route: Route, data: unknown, status = 200, meta: unknown = null) => route.fulfill({
  status, contentType: "application/json", body: JSON.stringify(status < 400 ? { data, meta } : data),
});
const jobsPage = (items: unknown[] = [job], page = 1, total = items.length, hasMore = false) => ({ items, page, limit: 6, total, hasMore, nextCursor: null, source: "POSTGRESQL" });

test.beforeAll(async () => {
  // Company profile is rendered on the server. Browser routes cover the client API calls.
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === `/companies/${companyId}`) res.end(JSON.stringify({ data: company, meta: null }));
    else res.writeHead(404).end(JSON.stringify({ code: "COMPANY_NOT_FOUND" }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(4174, "127.0.0.1", resolve); });
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function setup(page: Page, role: "CANDIDATE" | "RECRUITER" | null = "CANDIDATE") {
  await page.addInitScript(() => {
    class TestStream extends EventTarget { close() {} }
    (window as any).EventSource = TestStream;
  });
  await page.route(api + "/**", route => reply(route, { code: "UNMOCKED_FIXTURE" }, 404));
  await page.route(api + "/auth/me", route => role ? reply(route, { id: userId, email: "companies@example.test", role }) : reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/refresh", route => reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/profile/" + userId, route => reply(route, { userId, fullName: "Ứng viên thử nghiệm" }));
  await page.route(api + "/notifications/unread-count", route => reply(route, { unread_count: 0 }));
  await page.route(api + "/companies/search**", route => reply(route, [company], 200, { hasMore: false, nextCursor: null }));
  await page.route(api + "/jobs/search**", route => reply(route, jobsPage()));
  await page.route(api + "/jobs/" + jobId, route => reply(route, job));
  await page.route(api + "/jobs/recommended**", route => reply(route, { items: [], hasMore: false, nextCursor: null }));
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("candidate directory opens verified profile, its jobs and back without leaving the portal", async ({ page }, info) => {
  await setup(page);
  const requests: URL[] = [];
  await page.route(api + "/jobs/search**", route => { requests.push(new URL(route.request().url())); return reply(route, jobsPage()); });
  await page.goto("/candidate/companies");
  await expect(page.getByRole("heading", { name: "Doanh nghiệp đã xác minh", exact: true })).toBeVisible();
  await openWorkspaceMenu(page);
  await expect(page.locator(".workspace-navigation").getByRole("link", { name: "Công ty", exact: true })).toHaveAttribute("aria-current", "page");
  const close = page.getByRole("button", { name: "Đóng menu", exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole("link", { name: `Xem hồ sơ ${company.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/candidate/companies/${companyId}$`));
  await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Việc làm đang tuyển", exact: true })).toBeVisible();
  await expect(page.getByText("1 vị trí", { exact: true })).toBeVisible();
  const jobLink = page.locator(".company-jobs").getByRole("link", { name: /Kỹ sư sản phẩm/ });
  await expect(jobLink).toContainText("20.000.000 – 35.000.000 VND");
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) expect(url.searchParams.get("companyId")).toBe(companyId);
  await expect(page.locator(".workspace-header")).toHaveCount(1);
  await fits(page);
  await page.screenshot({ path: info.outputPath("company-profile.png"), fullPage: true, animations: "disabled" });
  await jobLink.click();
  await expect(page).toHaveURL(new RegExp(`/candidate/jobs/${jobId}\\?source=COMPANY_PAGE$`));
  await expect(page.getByRole("heading", { level: 1, name: job.title })).toBeVisible();
  await expect(page.locator(".workspace-header")).toHaveCount(1);
  await page.getByRole("link", { name: "Xem công ty", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
  await page.getByRole("link", { name: "Quay về danh sách", exact: true }).click();
  await expect(page).toHaveURL(/\/candidate\/companies$/);
});

test("company jobs keep their filter on load more and retry without losing loaded jobs", async ({ page }) => {
  await setup(page);
  let fail = true;
  const pages: string[] = [];
  await page.route(api + "/jobs/search**", route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("companyId")).toBe(companyId);
    expect(url.searchParams.get("sort")).toBe("NEWEST");
    expect(url.searchParams.get("limit")).toBe("6");
    const pageNo = url.searchParams.get("page")!;
    pages.push(pageNo);
    if (pageNo === "1") return reply(route, jobsPage([job], 1, 7, true));
    if (fail) return reply(route, { code: "JOB_SEARCH_UNAVAILABLE", message: "internal-db-secret" }, 503);
    return reply(route, jobsPage([job, { ...job, id: otherId, title: "Kỹ sư dữ liệu" }], 2, 7));
  });
  await page.goto(`/candidate/companies/${companyId}`);
  await page.getByRole("button", { name: "Xem thêm việc làm của công ty" }).click();
  await expect(page.locator(".company-jobs [role=alert]")).toBeVisible();
  await expect(page.getByText("internal-db-secret")).toHaveCount(0);
  await expect(page.locator(".company-job-card")).toHaveCount(1);
  fail = false;
  await page.locator(".company-jobs").getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.locator(".company-job-card")).toHaveCount(2);
  expect(pages.filter(value => value === "2").length).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Xem thêm việc làm của công ty" })).toHaveCount(0);
});

test("verified company without openings shows an honest empty state", async ({ page }) => {
  await setup(page);
  await page.route(api + "/jobs/search**", route => reply(route, jobsPage([])));
  await page.goto(`/candidate/companies/${companyId}`);
  await expect(page.getByRole("heading", { name: "Công ty chưa có tin đang tuyển", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Khám phá việc làm", exact: true })).toHaveAttribute("href", "/candidate/jobs");
  await expect(page.getByText("0 vị trí", { exact: true })).toBeVisible();
});

test("unverified or missing company cannot display a profile or load its jobs", async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route(api + "/jobs/search**", route => { reads++; return reply(route, jobsPage()); });
  await page.goto(`/candidate/companies/${otherId}`);
  await expect(page.getByRole("heading", { name: "Không tìm thấy doanh nghiệp", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quay về danh sách", exact: true })).toHaveAttribute("href", "/candidate/companies");
  expect(reads).toBe(0);
});

test("company search submits keywords and recovers after a failed request", async ({ page }) => {
  await setup(page);
  let fail = true;
  let keyword: string | null = null;
  await page.route(api + "/companies/search**", route => {
    keyword = new URL(route.request().url()).searchParams.get("q");
    return fail ? reply(route, { code: "COMPANY_SEARCH_UNAVAILABLE" }, 503) : reply(route, [company], 200, { hasMore: false });
  });
  await page.goto("/candidate/companies");
  await expect(page.locator("main [role=alert]")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByRole("link", { name: `Xem hồ sơ ${company.name}` })).toBeVisible();
  await page.getByRole("searchbox", { name: "Tên công ty", exact: true }).fill("Sản phẩm");
  await expect.poll(() => keyword).toBe("Sản phẩm");
  await fits(page);
});

test("guest can browse companies through candidate and existing public routes", async ({ page }) => {
  await setup(page, null);
  for (const base of ["/candidate/companies", "/companies"]) {
    await page.goto(base);
    await page.getByRole("link", { name: `Xem hồ sơ ${company.name}` }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/${companyId}$`));
    await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
    await expect(page.locator(".company-job-card")).toHaveCount(1);
    await expect(page.locator(".topbar")).toHaveCount(1);
    await expect(page.locator(".workspace-header")).toHaveCount(0);
  }
});

test("recruiter cannot accidentally enter the candidate company workspace", async ({ page }) => {
  await setup(page, "RECRUITER");
  let reads = 0;
  await page.route(api + "/companies/search**", route => { reads++; return reply(route, [company]); });
  await page.goto("/candidate/companies");
  await expect(page.getByRole("heading", { name: "Bạn không có quyền truy cập", exact: true })).toBeVisible();
  expect(reads).toBe(0);
  await expect(page.getByRole("link", { name: "Về không gian của tôi", exact: true })).toHaveAttribute("href", "/recruiter/dashboard");
});
