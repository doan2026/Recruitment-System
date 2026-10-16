import { proxyAuthCookie } from "../../../../lib/authCookieProxy";

// Keep the canonical path: Google's one-time binder cookie is scoped here.
export function POST(req: Request) {
  return proxyAuthCookie(req, "google");
}
