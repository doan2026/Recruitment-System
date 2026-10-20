import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";

const account = { id: "4795c0de-7908-4ab5-9bed-4c4f1cf9c213", email: "cookie@example.test", role: "CANDIDATE" };
let server: Server;
let calls: { path: string; body: Record<string, unknown>; authorization?: string; cookie?: string }[];
let failLogout = false;
let activeRefresh = "refresh-one";

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    calls.push({ path: req.url!, body, authorization: req.headers.authorization,
      ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}) });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/logout") {
      if (failLogout) { res.writeHead(503).end(); return; }
      if (body.refreshToken !== activeRefresh) { res.writeHead(401).end(); return; }
      activeRefresh = "revoked";
      res.writeHead(204).end(); return;
    }
    if (req.url === "/auth/login" || req.url === "/auth/refresh"
      || req.url === "/auth/otp/verify" || req.url === "/auth/google/exchange") {
      if (req.url === "/auth/google/exchange" && req.headers.cookie !== "oauth2_exchange_binder=binder-fixture") {
        res.writeHead(401).end(JSON.stringify({ code: "INVALID_EXCHANGE" })); return;
      }
      if (req.url === "/auth/refresh") {
        if (body.refreshToken !== activeRefresh) { res.writeHead(401).end(); return; }
        activeRefresh = "refresh-two";
      }
      res.end(JSON.stringify({ data: { user: account, accessToken: "access-fixture", refreshToken: activeRefresh,
        accessTokenExpiresInSeconds: 900, refreshTokenExpiresInSeconds: 604800 }, meta: null })); return;
    }
    if (req.url === "/auth/me" && req.headers.authorization === "Bearer access-fixture") {
      res.end(JSON.stringify({ data: account, meta: null })); return;
    }
    res.writeHead(401).end(JSON.stringify({ code: "AUTH_INVALID" }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(4174, "127.0.0.1", resolve); });
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
test.beforeEach(() => { calls = []; failLogout = false; activeRefresh = "refresh-one"; });

test("real cookie login, refresh and logout forward credentials and revoke the latest refresh", async ({ page, context }) => {
  await page.goto("/login");
  const login = await page.evaluate(async () => {
    const response = await fetch("/api/auth-cookie/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "cookie@example.test", password: "fixture" }) });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  });
  expect(login).toEqual({ status: 200, body: { data: { user: account }, meta: null }, cache: "no-store" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("careerhub_");
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "careerhub_refresh")).toMatchObject({ path: "/api/auth-cookie", httpOnly: true, sameSite: "Lax" });
  const me = await page.request.get("/api/auth/me");
  expect((await me.json()).data).toEqual(account);
  expect(calls.find((c) => c.path === "/auth/me" && c.authorization)).toMatchObject({ authorization: "Bearer access-fixture" });
  const refresh = await page.request.post("/api/auth-cookie/refresh", { data: {} });
  expect(refresh.status()).toBe(200);
  expect(await refresh.json()).toEqual({ data: { user: account }, meta: null });
  const logout = await page.request.post("/api/auth-cookie/logout", { data: {} });
  expect(logout.status()).toBe(204);
  expect(calls.filter((c) => c.path === "/auth/logout")).toEqual([{ path: "/auth/logout", body: { refreshToken: "refresh-two" }, authorization: undefined }]);
  expect(activeRefresh).toBe("revoked");
  expect((await context.cookies()).filter((c) => c.name.startsWith("careerhub_"))).toEqual([]);
});

test("logout clears cookies but reports a failed server revocation", async ({ page, context }) => {
  await page.request.post("/api/auth-cookie/login", { data: { email: account.email, password: "fixture" } });
  failLogout = true;
  const response = await page.request.post("/api/auth-cookie/logout", { data: {} });
  expect(response.status()).toBe(503);
  expect((await response.json()).code).toBe("AUTH_LOGOUT_FAILED");
  expect((await context.cookies()).filter((c) => c.name.startsWith("careerhub_"))).toEqual([]);
});

test("refresh migrates the legacy cookie path before logout", async ({ page, context }) => {
  await context.addCookies([{ name: "careerhub_refresh", value: "refresh-one", domain: "127.0.0.1", path: "/api/auth-cookie/refresh", httpOnly: true, sameSite: "Lax" }]);
  expect((await page.request.post("/api/auth-cookie/refresh", { data: {} })).status()).toBe(200);
  const cookies = (await context.cookies()).filter((c) => c.name === "careerhub_refresh");
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({ path: "/api/auth-cookie", value: "refresh-two" });
  expect((await page.request.post("/api/auth-cookie/logout", { data: {} })).status()).toBe(204);
  expect(activeRefresh).toBe("revoked");
});

test("cross-origin cookie mutation is rejected before calling Auth", async ({ page }) => {
  const response = await page.request.post("/api/auth-cookie/login", { headers: { Origin: "https://untrusted.test" }, data: { email: account.email, password: "fixture" } });
  expect(response.status()).toBe(403);
  expect(calls).toHaveLength(0);
});

test("OTP verification establishes the same HttpOnly session without exposing tokens", async ({ page, context }) => {
  const response = await page.request.post("/api/auth-cookie/verify", {
    data: { email: account.email, registrationId: account.id, otp: "123456" },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ data: { user: account }, meta: null });
  expect(calls.find(c => c.path === "/auth/otp/verify")?.body).toEqual({ email: account.email, registrationId: account.id, otp: "123456" });
  expect((await context.cookies()).find(c => c.name === "careerhub_token")).toMatchObject({ httpOnly: true, value: "access-fixture" });
});

test("canonical Google exchange forwards only its binder and establishes HttpOnly cookies", async ({ page, context }) => {
  await context.addCookies([
    { name: "oauth2_exchange_binder", value: "binder-fixture", domain: "127.0.0.1", path: "/auth/google/exchange", httpOnly: true },
    { name: "unrelated", value: "private-fixture", domain: "127.0.0.1", path: "/" },
  ]);
  const response = await page.request.post("/auth/google/exchange", { data: { code: "one-time-code", role: "CANDIDATE" } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ data: { user: account }, meta: null });
  expect(calls.find(c => c.path === "/auth/google/exchange")).toMatchObject({ cookie: "oauth2_exchange_binder=binder-fixture" });
  const cookies = await context.cookies();
  expect(cookies.some(c => c.name === "oauth2_exchange_binder")).toBe(false);
  expect(cookies.find(c => c.name === "careerhub_refresh")).toMatchObject({ httpOnly: true, path: "/api/auth-cookie" });
});

test("Google exchange cannot skip the one-time binder", async ({ page }) => {
  const response = await page.request.post("/auth/google/exchange", { data: { code: "one-time-code", role: "CANDIDATE" } });
  expect(response.status()).toBe(401);
  expect((await response.json()).code).toBe("INVALID_EXCHANGE");
});

test("Google callback confirms the real Next HttpOnly session before landing and survives reload", async ({ page, context }) => {
  await context.addCookies([{ name: "oauth2_exchange_binder", value: "binder-fixture", domain: "127.0.0.1", path: "/auth/google/exchange", httpOnly: true }]);
  // Only page content is mocked. Exchange, Set-Cookie, identity lookup and
  // cookie-to-Bearer middleware all use the real Next server and Auth fixture.
  await page.route("**/api/profile/" + account.id, route => route.fulfill({ json: { data: {
    userId: account.id, fullName: "Cookie Candidate", completionPercent: 0, missingSections: [],
    educations: [], experiences: [], skills: [], certificates: [], projects: [],
  }, meta: null } }));
  await page.route("**/api/notifications**", route => route.fulfill({ json: { data:
    route.request().url().includes("unread-count") ? { unread_count: 0 } : [], meta: null } }));
  await page.goto("/auth/callback#code=fixture-code&role=CANDIDATE");
  await expect(page).toHaveURL(/\/candidate\/profile$/);
  await expect(page.getByRole("heading", { name: "Hồ sơ cá nhân", exact: true })).toBeVisible();
  expect(calls.filter(call => call.path === "/auth/google/exchange")).toHaveLength(1);
  expect(calls.find(call => call.path === "/auth/me")).toMatchObject({ authorization: "Bearer access-fixture" });
  expect((await context.cookies()).find(cookie => cookie.name === "careerhub_token")).toMatchObject({ httpOnly: true, path: "/" });
  expect((await context.cookies()).find(cookie => cookie.name === "careerhub_refresh")).toMatchObject({ httpOnly: true, path: "/api/auth-cookie" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("careerhub_");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hồ sơ cá nhân", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Đăng nhập để tiếp tục", exact: true })).toHaveCount(0);
});


for (const authenticated of [true, false]) {
  test(`same-origin chat WebSocket preserves gateway authentication: cookie ${authenticated}`, async ({ page, context }) => {
    if (authenticated) await context.addCookies([{ name: "careerhub_token", value: "access-fixture", domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
    let gatewayPath = "";
    let cookieForwarded = false;
    server.once("upgrade", (request, socket) => {
      gatewayPath = request.url ?? "";
      cookieForwarded = request.headers.cookie?.includes("careerhub_token=access-fixture") ?? false;
      if (!cookieForwarded) { socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"); return; }
      const accept = createHash("sha1").update(String(request.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
      // Keep the tunnel open until the browser completes its handshake and closes.
      socket.once("data", () => socket.end(Buffer.from([0x88, 0x00])));
    });
    // Isolate transport from the Auth fixture's intentionally missing notification APIs.
    // The document is static; the WebSocket still traverses the real Next proxy.
    await page.goto("/icon.svg");
    const connected = await page.evaluate(() => new Promise<boolean>(resolve => {
      const socket = new WebSocket(`ws://${location.host}/api/chat/ws/chat`);
      const timeout = setTimeout(() => { socket.close(); resolve(false); }, 5000);
      socket.onopen = () => { clearTimeout(timeout); socket.close(); resolve(true); };
      socket.onerror = () => { clearTimeout(timeout); resolve(false); };
    }));
    expect(connected).toBe(authenticated);
    expect(gatewayPath).toBe("/chat/ws/chat");
    expect(cookieForwarded).toBe(authenticated);
  });
}
