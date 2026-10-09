import Link from "next/link";
import type { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" style={{ gap: "8px", display: "flex", alignItems: "center" }}>
            <Logo size={32} />
            <span style={{ fontSize: "1.25rem", fontWeight: "bold" }}>CareerHub</span>
          </Link>
          <AccountNavigation />
        </div>
      </header>
      <div className="content-wrap">
        {children}
      </div>
      <footer className="site-footer">CareerHub — Không gian nghề nghiệp rõ ràng hơn mỗi ngày</footer>
    </div>
  );
}
