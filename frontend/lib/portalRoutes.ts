export type AccountRole = "CANDIDATE" | "RECRUITER" | "ADMIN";
export type PortalSection = "messages" | "notifications" | "reports";

export function portalHome(role: AccountRole): string {
  return role === "ADMIN" ? "/admin" : role === "RECRUITER" ? "/recruiter/dashboard" : "/candidate/dashboard";
}

export function portalEntry(role: AccountRole): string {
  return role === "ADMIN" ? "/admin" : role === "RECRUITER" ? "/recruiter" : "/";
}

export function portalLabel(role: AccountRole): string {
  return role === "ADMIN" ? "Quản trị viên" : role === "RECRUITER" ? "Nhà tuyển dụng" : "Ứng viên";
}

export function portalSection(role: AccountRole, section: PortalSection): string {
  if (role === "ADMIN" && section !== "notifications") return portalHome(role);
  return `/${role.toLowerCase()}/${section}`;
}

export function portalCall(role: AccountRole, callId: string): string {
  return role === "ADMIN" ? portalHome(role) : `/${role.toLowerCase()}/calls/${encodeURIComponent(callId)}`;
}

/** Keep bookmarked shared URLs working without leaving the current portal. */
export function scopedDestination(role: AccountRole, pathname: string): string {
  if (["/messages", "/notifications", "/reports"].includes(pathname)) {
    return portalSection(role, pathname.slice(1) as PortalSection);
  }
  if (pathname === "/ai") return role === "CANDIDATE" ? "/candidate/ai" : portalHome(role);
  const call = /^\/interviews\/([0-9a-f-]{36})\/room$/i.exec(pathname);
  return call ? portalCall(role, call[1]) : pathname;
}
