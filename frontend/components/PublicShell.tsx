"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";
import { useCurrentAccount } from "./SessionGate";
import { RecruiterShell } from "./RecruiterShell";
import { AdminShell } from "./AdminShell";
import { portalEntry, type AccountRole } from "@/lib/portalRoutes";

export function PublicShell({ children, portal = "CANDIDATE" }: { children: ReactNode; portal?: AccountRole }) {
  const account = useCurrentAccount();
  if (account?.role === "RECRUITER") return <RecruiterShell>{children}</RecruiterShell>;
  if (account?.role === "ADMIN") return <AdminShell>{children}</AdminShell>;
  return <div className={`app-shell public-shell ${portal === "RECRUITER" ? "recruiter-public" : "candidate-public"}`} data-portal={portal.toLowerCase()}>
    <a className="skip-link" href="#public-content">Bỏ qua điều hướng</a>
    <header className="topbar"><div className="topbar-inner">
      <Link prefetch={false} className="brand shell-brand" href={portalEntry(portal)} aria-label="CareerHub - Trang chủ"><Logo size={34} /><span>CareerHub<small>{portal === "RECRUITER" ? "Dành cho nhà tuyển dụng" : "Tiếp bước sự nghiệp của bạn"}</small></span></Link>
      <AccountNavigation portal={portal} />
    </div></header>
    <div id="public-content" className="content-wrap" tabIndex={-1}>{children}</div>
    <footer className="public-footer"><div><strong>CareerHub<span className="brand-dot">.</span></strong><p>{portal === "RECRUITER" ? "Xây dựng đội ngũ. Cùng nhau tiến xa." : "Cơ hội phù hợp. Tương lai rộng mở."}</p></div><nav aria-label="Liên kết cuối trang">
      {portal === "RECRUITER" ? <><Link href="/recruiter#solutions">Giải pháp tuyển dụng</Link><Link href="/recruiter/login">Đăng nhập</Link><Link href="/recruiter/register">Bắt đầu tuyển dụng</Link></> : <><Link href="/candidate/jobs">Tìm việc làm</Link><Link href={account?.role === "CANDIDATE" ? "/candidate/companies" : "/companies"}>Khám phá doanh nghiệp</Link><Link href="/candidate/profile/cvs">Tạo CV</Link><Link href="/recruiter">Nhà tuyển dụng</Link></>}
    </nav></footer>
  </div>;
}
