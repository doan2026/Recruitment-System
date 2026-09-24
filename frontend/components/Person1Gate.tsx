"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCurrentAccount } from "./SessionGate";
export function Person1Gate({
  children,
  role,
}: {
  children: ReactNode;
  role: "CANDIDATE" | "ADMIN";
}) {
  const account = useCurrentAccount();
  const path = usePathname();
  if (!account)
    return (
      <section className="card empty-state">
        <h1>Đăng nhập để tiếp tục</h1>
        <Link
          className="btn btn-primary"
          href={`/login?returnTo=${encodeURIComponent(path)}`}
        >
          Đăng nhập
        </Link>
      </section>
    );
  if (account.role !== role)
    return (
      <section className="card" role="alert">
        <h1>Bạn không có quyền truy cập</h1>
        <Link href="/">Trang chủ</Link>
      </section>
    );
  return <>{children}</>;
}
