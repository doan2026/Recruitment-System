import Link from "next/link";
import { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";

export function CandidateShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell candidate-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" style={{ gap: "8px", display: "flex", alignItems: "center" }}>
            <Logo size={32} />
            <span style={{ fontSize: "1.25rem", fontWeight: "bold" }}>CareerHub</span>
          </Link>
          <AccountNavigation />
        </div>
      </header>
      <div className="shell-body" style={{ display: 'flex', flex: 1, margin: '0 auto', width: '100%', gap: '24px', padding: '24px 20px' }}>
        <aside className="sidebar" style={{ width: 240, flexShrink: 0 }}>
          <nav className="stack" style={{ gap: '8px' }}>
            <Link href="/candidate/dashboard" className="sidebar-link">Dashboard</Link>
            <Link href="/candidate/profile" className="sidebar-link">Hồ sơ cá nhân</Link>
            <Link href="/candidate/profile/cvs" className="sidebar-link">Quản lý CV</Link>
            <Link href="/candidate/applications" className="sidebar-link">Đơn ứng tuyển</Link>
            <Link href="/candidate/interviews" className="sidebar-link">Lịch phỏng vấn</Link>
            <Link href="/candidate/bookmarks" className="sidebar-link">Việc làm đã lưu</Link>
            <Link href="/messages" className="sidebar-link">Tin nhắn</Link>
          </nav>
        </aside>
        <main className="content" style={{ flex: 1 }}>
          {children}
        </main>
      </div>
      <footer className="site-footer">CareerHub — Không gian nghề nghiệp rõ ràng hơn mỗi ngày</footer>
    </div>
  );
}
