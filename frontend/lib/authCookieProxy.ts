import { NextRequest, NextResponse } from "next/server";
import { apiUrl } from "./apiRoutes";

const refreshPath = "/api/auth-cookie";
const legacyRefreshPath = "/api/auth-cookie/refresh";
const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

type Action = "login" | "verify" | "google" | "refresh" | "logout";
const endpoints: Record<Action, string> = {
  login: "/api/auth/login", verify: "/api/auth/otp/verify", google: "/api/auth/google/exchange",
  refresh: "/api/auth/refresh", logout: "/api/auth/logout",
};

function cookieOptions(req: Request, path: string, maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: (req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:"), path, maxAge };
}

function clearCookies(response: NextResponse, req: Request): void {
  response.cookies.set("careerhub_token", "", cookieOptions(req, "/", 0));
  response.cookies.set("careerhub_refresh", "", cookieOptions(req, refreshPath, 0));
}

function clearLegacyCookie(response: NextResponse): void {
  // Append separately: ResponseCookies indexes by name, so setting twice would
  // overwrite the new cookie instead of expiring the old, more specific path.
  response.headers.append("Set-Cookie", `careerhub_refresh=; Path=${legacyRefreshPath}; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export async function proxyAuthCookie(req: Request, action: Action): Promise<NextResponse> {
  const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: noStore });
  // Cookie credentials must only be usable by the frontend's own origin.
  const origin = req.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== req.headers.get("host")) return json({ code: "FORBIDDEN" }, 403); }
    catch { return json({ code: "FORBIDDEN" }, 403); }
  }

  let response: NextResponse;
  try {
    const cookies = new NextRequest(req.url, { headers: req.headers }).cookies;
    const needsRefresh = action === "refresh" || action === "logout";
    const refreshToken = needsRefresh ? cookies.get("careerhub_refresh")?.value : undefined;
    if (needsRefresh && !refreshToken) {
      response = action === "logout" ? new NextResponse(null, { status: 204, headers: noStore }) : json({ code: "AUTH_INVALID" }, 401);
      clearCookies(response, req);
    } else {
      const body = needsRefresh ? { refreshToken } : await req.json();
      const binder = action === "google" ? cookies.get("oauth2_exchange_binder")?.value : undefined;
      const gateway = (process.env.API_INTERNAL_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
      const upstream = await fetch(apiUrl(endpoints[action], gateway), {
        method: "POST", headers: { "Content-Type": "application/json",
          ...(binder ? { Cookie: `oauth2_exchange_binder=${binder}` } : {}) },
        body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (action === "logout") {
        response = upstream.ok ? new NextResponse(null, { status: 204, headers: noStore }) : json({ code: "AUTH_LOGOUT_FAILED" }, upstream.status);
        clearCookies(response, req);
      } else if (!upstream.ok) {
        const failure = await upstream.json().catch(() => null);
        response = json({ code: typeof failure?.code === "string" ? failure.code : "AUTH_INVALID" }, upstream.status);
        if (action === "refresh" && [401, 403].includes(upstream.status)) clearCookies(response, req);
      } else {
        const payload = await upstream.json();
        const data = payload?.data;
        if (!data?.user || typeof data.accessToken !== "string" || !data.accessToken || typeof data.refreshToken !== "string" || !data.refreshToken) {
          throw new Error("Invalid Auth response");
        }
        // Only the account crosses the browser boundary; credentials stay HttpOnly.
        response = json({ data: { user: data.user }, meta: null }, 200);
        response.cookies.set("careerhub_token", data.accessToken, cookieOptions(req, "/", data.accessTokenExpiresInSeconds || 900));
        response.cookies.set("careerhub_refresh", data.refreshToken, cookieOptions(req, refreshPath, data.refreshTokenExpiresInSeconds || 604800));
      }
    }
  } catch {
    response = json({ code: "AUTH_SERVICE_UNAVAILABLE" }, 502);
    if (action === "logout") clearCookies(response, req);
  }
  if (response.cookies.has("careerhub_refresh")) clearLegacyCookie(response);
  if (action === "google") response.cookies.set("oauth2_exchange_binder", "",
    cookieOptions(req, "/auth/google/exchange", 0));
  return response;
}
