import Link from "next/link";
import { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell admin-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="topbar" style={{ background: '#1c2433', color: 'white' }}>
        <div className="topbar-inner">
          <Link className="brand" href="/admin" style={{ color: 'white', gap: "8px", display: "flex", alignItems: "center" }}>
            <Logo size={32} />
            <span style={{ fontSize: "1.25rem", fontWeight: "bold" }}>CareerHub Admin</span>
          </Link>
          <AccountNavigation />
        </div>
      </header>
      <div className="shell-body" style={{ display: 'flex', flex: 1 }}>
        <aside className="sidebar admin-sidebar" style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--line)', background: '#f8fafc', padding: '24px 20px' }}>
          <nav className="stack" style={{ gap: '8px' }}>
            <Link href="/admin" className="sidebar-link">Tổng quan</Link>
            <Link href="/admin/users" className="sidebar-link">Quản lý người dùng</Link>
            <Link href="/admin/jobs" className="sidebar-link">Quản lý việc làm</Link>
            <Link href="/admin/companies" className="sidebar-link">Duyệt công ty</Link>
            <Link href="/admin/reports" className="sidebar-link">Báo cáo vi phạm</Link>
          </nav>
        </aside>
        <main className="content" style={{ flex: 1, padding: '24px 32px' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
