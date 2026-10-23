/** Backend URLs always live below /api; page URLs belong to portalRoutes. */
export function apiPath(path: string): string {
  const pathname = path.split("?")[0];
  if (!path.startsWith("/") || path.startsWith("//") || /[\\#\u0000-\u0020\u007f]/.test(path)
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(pathname))) {
    throw new Error("Invalid API path");
  }
  return path === "/api" || path.startsWith("/api/") ? path : `/api${path}`;
}

/** Accept either a gateway origin or an origin ending in /api, without duplication. */
export function apiUrl(path: string, gateway = ""): string {
  const base = gateway.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  return `${base}${apiPath(path)}`;
}
