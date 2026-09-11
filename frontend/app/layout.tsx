import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccountNavigation } from "../components/AccountNavigation";
import { ApiSessionBoundary } from "../components/ApiSessionBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CareerHub", template: "%s — CareerHub" },
  description: "Nền tảng tuyển dụng kết nối ứng viên và doanh nghiệp.",
};

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
              <AccountNavigation />
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
