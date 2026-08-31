import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ApiSessionBoundary } from "../components/ApiSessionBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CareerHub", template: "%s — CareerHub" },
  description: "Nền tảng tuyển dụng kết nối ứng viên và doanh nghiệp.",
};

const navItems = [
  { label: "Trang chủ", href: "/" },
  { label: "Việc làm", href: "/candidate/jobs" },
  { label: "Doanh nghiệp", href: "/companies" },
  { label: "Ứng tuyển của tôi", href: "/candidate/applications" },
  { label: "Tuyển dụng", href: "/recruiter/jobs" },
  { label: "Hồ sơ công ty", href: "/recruiter/company" },
  { label: "AI Assistant", href: "/ai" },
];

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="topbar-inner">
              <Link className="brand" href="/">
                <span className="brand-mark" aria-hidden="true">C</span>
                <span>CareerHub</span>
              </Link>
              <nav className="top-nav" aria-label="Điều hướng chính">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="profile-chip" aria-label="Tài khoản demo Người 2">
                <span className="avatar" aria-hidden="true">NA</span>
                <span className="profile-copy"><strong>Nguyễn An</strong><small>Recruiter</small></span>
              </div>
            </div>
          </header>
          <div className="content-wrap">
            <ApiSessionBoundary>{children}</ApiSessionBoundary>
          </div>
          <footer className="site-footer">CareerHub · Không gian nghề nghiệp rõ ràng hơn mỗi ngày</footer>
        </div>
      </body>
    </html>
  );
}
