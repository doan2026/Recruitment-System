import Link from "next/link";
import type { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";

export function PublicShell({ children }: { children: ReactNode }) {
  return <div className="app-shell public-shell">
    <header className="topbar"><div className="topbar-inner">
      <Link className="brand shell-brand" href="/" aria-label="CareerHub - Trang chủ"><Logo size={34} /><span>CareerHub<small>Kết nối cơ hội nghề nghiệp</small></span></Link>
      <AccountNavigation />
    </div></header>
    <div className="content-wrap">{children}</div>
    <footer className="public-footer"><div><strong>CareerHub</strong><p>Kết nối cơ hội, phát triển sự nghiệp.</p></div><nav aria-label="Liên kết cuối trang"><Link href="/candidate/jobs">Tìm việc làm</Link><Link href="/companies">Khám phá doanh nghiệp</Link><Link href="/recruiter/login">Dành cho nhà tuyển dụng</Link></nav></footer>
  </div>;
}
