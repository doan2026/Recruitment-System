"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";
import { useCurrentAccount } from "./SessionGate";
import { isDemoPerson2Api } from "../lib/person2Api";

export function CandidateShell({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
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
      <div className="shell-body">
        {(isDemoPerson2Api || account?.role === "CANDIDATE") && <aside className="sidebar">
          <nav className="stack" style={{ gap: '8px' }}>
            <Link href="/candidate/dashboard" className="sidebar-link">Dashboard</Link>
            <Link href="/candidate/profile" className="sidebar-link">Hồ sơ cá nhân</Link>
            <Link href="/candidate/profile/cvs" className="sidebar-link">Quản lý CV</Link>
            <Link href="/candidate/applications" className="sidebar-link">Đơn ứng tuyển</Link>
            <Link href="/candidate/interviews" className="sidebar-link">Lịch phỏng vấn</Link>
            <Link href="/candidate/bookmarks" className="sidebar-link">Việc làm đã lưu</Link>
            <Link href="/messages" className="sidebar-link">Tin nhắn</Link>
          </nav>
        </aside>}
        <main className="content">
          {children}
        </main>
      </div>
      <footer className="site-footer">CareerHub — Không gian nghề nghiệp rõ ràng hơn mỗi ngày</footer>
    </div>
  );
}
