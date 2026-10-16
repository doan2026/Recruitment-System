import Link from "next/link";
import { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";

export function RecruiterShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell recruiter-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" style={{ gap: "8px", display: "flex", alignItems: "center" }}>
            <Logo size={32} />
            <span style={{ fontSize: "1.25rem", fontWeight: "bold" }}>CareerHub Recruiter</span>
          </Link>
          <AccountNavigation />
        </div>
      </header>
      <div className="shell-body">
        <aside className="sidebar recruiter-sidebar">
          <nav className="stack" style={{ gap: '8px' }}>
            <Link href="/recruiter/dashboard" className="sidebar-link">Dashboard</Link>
            <Link href="/recruiter/jobs" className="sidebar-link">Quản lý tin tuyển dụng</Link>
            <Link href="/recruiter/applications" className="sidebar-link">Hồ sơ ứng tuyển</Link>
            <Link href="/recruiter/candidate-recommendations" className="sidebar-link">Tìm kiếm ứng viên</Link>
            <Link href="/recruiter/company" className="sidebar-link">Hồ sơ công ty</Link>
            <Link href="/messages" className="sidebar-link">Tin nhắn</Link>
          </nav>
        </aside>
        <main className="content">
          {children}
        </main>
      </div>
    </div>
  );
}
