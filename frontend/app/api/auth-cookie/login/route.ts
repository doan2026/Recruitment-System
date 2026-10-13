import { proxyAuthCookie } from "../../../../lib/authCookieProxy";

export function POST(req: Request) {
  return proxyAuthCookie(req, "login");
}
