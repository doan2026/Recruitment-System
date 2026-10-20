import { expect, test } from "@playwright/test";
import { createServer, request, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// Uses the actual production nginx configuration and actual Next cookie proxy.
// Only Auth is a stand-in; no Google account, JWT key or cloud secret is needed.
test.skip(process.env.PRODUCTION_PROXY_TEST !== "1", "Set PRODUCTION_PROXY_TEST=1; Docker and OpenSSL are required");
test.use({ ignoreHTTPSErrors: true });

const root = resolve(process.cwd(), "..");
const container = `careerhub-oauth-routing-${process.pid}-${randomUUID().slice(0, 8)}`;
let auth: Server;
let adapter: Server;
let publicUrl = "";
let internalUrl = "";
let authExchanges = 0;
const issued = new Map<string, { id: string; email: string; role: string }>();
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 120_000 }).trim();
const listen = (server: Server, port: number, host: string) => new Promise<number>((done, reject) => {
  server.once("error", reject);
  server.listen(port, host, () => done((server.address() as { port: number }).port));
});
const close = async (server?: Server) => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
};

test.beforeAll(async () => {
  test.setTimeout(120_000);
  auth = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/google/exchange") {
      authExchanges++;
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text || "{}");
      if (!body.code) { res.writeHead(400).end(JSON.stringify({ code: "VALIDATION_ERROR", message: "Required code", details: {} })); return; }
      if (req.headers.cookie !== "oauth2_exchange_binder=fixture-binder") {
        res.writeHead(401).end(JSON.stringify({ code: "INVALID_EXCHANGE", message: "Binder required", details: {} })); return;
      }
      const user = { id: "4795c0de-7908-4ab5-9bed-4c4f1cf9c213", email: "proxy@example.test", role: body.role };
      const token = `fixture-access-${randomUUID()}`;
      issued.set(token, user);
      res.end(JSON.stringify({ data: { user, accessToken: token, refreshToken: "fixture-refresh", accessTokenExpiresInSeconds: 900 }, meta: null })); return;
    }
    if (req.url === "/auth/me") {
      const user = issued.get(req.headers.authorization?.replace(/^Bearer /, "") || "");
      if (!user) { res.writeHead(401).end(JSON.stringify({ code: "AUTH_INVALID" })); return; }
      res.end(JSON.stringify({ data: user, meta: null })); return;
    }
    if (req.url?.startsWith("/auth/google?")) {
      res.end(JSON.stringify({ routeOwner: "Auth", role: new URL(req.url, "http://fixture").searchParams.get("role") })); return;
    }
    if (req.url === "/4795c0de-7908-4ab5-9bed-4c4f1cf9c213") {
      res.end(JSON.stringify({ data: { userId: "4795c0de-7908-4ab5-9bed-4c4f1cf9c213", fullName: "Proxy Candidate", completionPercent: 0,
        missingSections: [], educations: [], experiences: [], skills: [], certificates: [], projects: [] }, meta: null })); return;
    }
    if (req.url === "/notifications/unread-count") { res.end(JSON.stringify({ data: { unread_count: 0 }, meta: null })); return; }
    if (req.url === "/notifications") { res.end(JSON.stringify({ data: [], meta: null })); return; }
    res.writeHead(401).end(JSON.stringify({ code: "AUTH_INVALID" }));
  });
  const authPort = await listen(auth, 0, "0.0.0.0");
  const directory = resolve(root, ".cache", container);
  mkdirSync(directory, { recursive: true });
  const openssl = process.env.OPENSSL_BIN || (process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl");
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", resolve(directory, "key.pem"), "-out", resolve(directory, "cert.pem")], { stdio: "pipe" });
  let config = readFileSync(resolve(root, "infra/nginx/nginx.prod.conf"), "utf8");
  // Map container services to local test upstreams, preserving all locations/maps.
  config = config.replace(/server frontend:3000 resolve;/g, "server host.docker.internal:4173;")
    .replace(/server [a-z-]+:\d+ resolve;/g, `server host.docker.internal:${authPort};`)
    .replace(/\/etc\/letsencrypt\/live\/[^/]+\/fullchain.pem/g, "/test/cert.pem")
    .replace(/\/etc\/letsencrypt\/live\/[^/]+\/privkey.pem/g, "/test/key.pem");
  writeFileSync(resolve(directory, "nginx.conf"), config);
  docker("run", "--detach", "--rm", "--name", container, "--publish", "127.0.0.1::443", "--publish", "127.0.0.1::8080",
    "--mount", `type=bind,source=${directory.replaceAll("\\", "/")},target=/test,readonly`,
    "nginx:1.30.4-alpine", "nginx", "-c", "/test/nginx.conf", "-g", "daemon off;");
  const ports = JSON.parse(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", container));
  publicUrl = `https://localhost:${ports["443/tcp"][0].HostPort}`;
  internalUrl = `http://127.0.0.1:${ports["8080/tcp"][0].HostPort}`;
  // Playwright's Next webServer is configured to use port 4174. This transparent
  // adapter makes its server-side API requests traverse nginx's internal listener.
  adapter = createServer((req, res) => {
    const upstream = request(new URL(req.url || "/", internalUrl), { method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode || 502, reply.headers); reply.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await listen(adapter, 4174, "127.0.0.1");
  docker("exec", container, "nginx", "-t", "-c", "/test/nginx.conf");
});

test.afterAll(async () => {
  try { docker("rm", "--force", container); } finally { await close(adapter); await close(auth); }
});

test("public callback renders Next while Google authorization stays with Auth", async ({ request }) => {
  const callback = await request.get(publicUrl + "/auth/callback");
  expect(callback.status()).toBe(200);
  expect(callback.headers()["content-type"]).toContain("text/html");
  expect(await callback.text()).toContain("/_next/");
  const start = await request.get(publicUrl + "/auth/google?role=RECRUITER");
  expect(await start.json()).toEqual({ routeOwner: "Auth", role: "RECRUITER" });
});

for (const role of ["CANDIDATE", "RECRUITER"]) {
  test(`public ${role} exchange sets Secure HttpOnly cookies and survives subsequent identity lookup`, async ({ context, page }) => {
    await context.addCookies([{ name: "oauth2_exchange_binder", value: "fixture-binder", domain: "localhost", path: "/auth/google/exchange", httpOnly: true, secure: true }]);
    const before = authExchanges;
    // Production uses standard HTTPS port 443; nginx's $host omits this fixture's
    // random published port. Supply its equivalent standard-port Origin here.
    const exchanged = await context.request.post(publicUrl + "/auth/google/exchange", {
      headers: { Origin: "https://localhost" }, data: { code: "fixture-code", role },
    });
    expect(exchanged.status()).toBe(200);
    const body = await exchanged.json();
    expect(Object.keys(body.data)).toEqual(["user"]);
    expect(body.data.user.role).toBe(role);
    expect(authExchanges - before).toBe(1);
    const cookies = await context.cookies();
    expect(cookies.find(c => c.name === "careerhub_token")).toMatchObject({ path: "/", secure: true, httpOnly: true });
    expect(cookies.find(c => c.name === "careerhub_refresh")).toMatchObject({ path: "/api/auth-cookie", secure: true, httpOnly: true });
    expect(cookies.some(c => c.name === "oauth2_exchange_binder")).toBe(false);
    const me = await context.request.get(publicUrl + "/api/auth/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).data.role).toBe(role);
    if (role === "CANDIDATE") {
      await page.goto(publicUrl + "/candidate/profile");
      await expect(page.getByRole("heading", { name: "Hồ sơ cá nhân", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "Hồ sơ cá nhân", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Đăng nhập để tiếp tục", exact: true })).toHaveCount(0);
    }
  });
}

test("public invalid exchange is handled by the cookie proxy without leaking Auth response fields", async ({ request }) => {
  const response = await request.post(publicUrl + "/auth/google/exchange", { headers: { Origin: "https://localhost" }, data: { code: "", role: "CANDIDATE" } });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ code: "VALIDATION_ERROR" });
});

test("internal exchange reaches Auth directly rather than looping through Next", async ({ request }) => {
  const before = authExchanges;
  const response = await request.post(internalUrl + "/auth/google/exchange", {
    headers: { Cookie: "oauth2_exchange_binder=fixture-binder" }, data: { code: "fixture-code", role: "CANDIDATE" },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).data).toHaveProperty("accessToken");
  expect(authExchanges - before).toBe(1);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});
