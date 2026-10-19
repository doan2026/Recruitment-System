"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";
import { useCurrentAccount } from "./SessionGate";

const links = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/users", label: "Quản lý người dùng" },
  { href: "/admin/jobs", label: "Duyệt tin tuyển dụng" },
  { href: "/admin/companies", label: "Duyệt công ty" },
  { href: "/admin/reports", label: "Báo cáo vi phạm" },
  { href: "/notifications", label: "Thông báo" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const account = useCurrentAccount();
  return (
    <div className="app-shell admin-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand shell-brand" href="/admin">
            <Logo size={32} />
            <span>CareerHub <small>Quản trị</small></span>
          </Link>
          <AccountNavigation />
        </div>
      </header>
      <div className="shell-body">
        {account?.role === "ADMIN" && <aside className="sidebar">
          <nav className="stack" aria-label="Khu vực quản trị">
            {links.map(({ href, label }) => <Link key={href} href={href} className="sidebar-link" aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}
          </nav>
        </aside>}
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
