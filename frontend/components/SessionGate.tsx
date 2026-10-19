"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useSyncExternalStore } from "react";
import { subscribeToApiSession } from "../lib/apiClient";
import { getCurrentAccount, type CurrentAccount } from "../lib/authSession";
import { isDemoPerson2Api } from "../lib/person2Api";
import { loginRoute } from "../lib/person1Api";
import { LoadingState } from "./ui";

export function useCurrentAccount(): CurrentAccount | null | undefined {
  return useSyncExternalStore(subscribeToApiSession, getCurrentAccount, () => undefined);
}

export function SessionGate({ children, role, publicJobRoutes = false }: { children: ReactNode; role: CurrentAccount["role"]; publicJobRoutes?: boolean }) {
  const account = useCurrentAccount();
  const pathname = usePathname();
  if (publicJobRoutes && /^\/candidate\/jobs(?:\/[^/]+)?$/.test(pathname)) return <>{children}</>;
  if (role === "RECRUITER" && (pathname === "/recruiter/login" || pathname === "/recruiter/register")) return <>{children}</>;
  if (isDemoPerson2Api) return <>{children}</>;
  if (account === undefined) return (
    <LoadingState label="Đang kiểm tra phiên đăng nhập" />
  );
  if (account === null) return (
    <section className="card empty-state">
      <h1>Đăng nhập để tiếp tục</h1>
      <p>Phiên đăng nhập chưa có hoặc đã hết hạn. Dữ liệu riêng tư chỉ được tải sau khi đăng nhập.</p>
      <Link className="btn btn-primary" href={`${loginRoute(role)}?returnTo=${encodeURIComponent(pathname + (typeof window !== "undefined" ? window.location.search : ""))}`}>Đăng nhập</Link>
    </section>
  );
  if (account.role !== role) return (
    <section className="card empty-state" role="alert">
      <h1>Bạn không có quyền truy cập</h1>
      <p>Trang này dành cho {role === "ADMIN" ? "quản trị viên" : role === "RECRUITER" ? "nhà tuyển dụng" : "ứng viên"}.</p>
      <Link className="btn" href="/candidate/jobs">Xem việc làm công khai</Link>
    </section>
  );
  return <>{children}</>;
}


