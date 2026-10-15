"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useSyncExternalStore } from "react";
import { subscribeToApiSession } from "../lib/apiClient";
import { getCurrentAccount, type CurrentAccount } from "../lib/authSession";
import { isDemoPerson2Api } from "../lib/person2Api";
import { loginRoute } from "../lib/person1Api";

export function useCurrentAccount(): CurrentAccount | null {
  return useSyncExternalStore(subscribeToApiSession, getCurrentAccount, () => null);
}

export function SessionGate({ children, role }: { children: ReactNode; role: CurrentAccount["role"] }) {
  const account = useCurrentAccount();
  const pathname = usePathname();
  if (role === "RECRUITER" && (pathname === "/recruiter/login" || pathname === "/recruiter/register")) return <>{children}</>;
  if (isDemoPerson2Api) return <>{children}</>;
  if (!account) return (
    <section className="card empty-state">
      <h1>Đăng nhập để tiếp tục</h1>
      <p>Phiên đăng nhập chưa có hoặc đã hết hạn. Dữ liệu riêng tư chỉ được tải sau khi đăng nhập.</p>
      <Link className="btn btn-primary" href={`${loginRoute(role)}?returnTo=${encodeURIComponent(pathname)}`}>Đăng nhập</Link>
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


