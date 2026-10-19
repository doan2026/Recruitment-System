"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";
import { useCurrentAccount } from "./SessionGate";

const links = [
  { href: "/recruiter/dashboard", label: "Tổng quan" },
  { href: "/recruiter/jobs", label: "Quản lý tin tuyển dụng" },
  { href: "/recruiter/applications", label: "Hồ sơ ứng tuyển" },
  { href: "/recruiter/candidate-recommendations", label: "Ứng viên gợi ý" },
  { href: "/recruiter/company", label: "Hồ sơ công ty" },
  { href: "/recruiter/invitations/accept", label: "Nhận lời mời" },
  { href: "/messages", label: "Tin nhắn" },
  { href: "/notifications", label: "Thông báo" },
];

export function RecruiterShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const account = useCurrentAccount();
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    const revealActiveLink = () => {
      if (cancelled) return;
      const navigation = navigationRef.current;
      const active = navigation?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!navigation || !active || !window.matchMedia("(max-width: 980px)").matches) return;
      const bounds = navigation.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left + 0) navigation.scrollLeft += item.left - bounds.left - 0;
      else if (item.right > bounds.right - 0) navigation.scrollLeft += item.right - bounds.right + 0;
    };
    revealActiveLink();
    // Web-font metrics can change the horizontal menu width after hydration.
    void document.fonts.ready.then(revealActiveLink);
    return () => { cancelled = true; };
  }, [pathname, account?.role]);
  return (
    <div className="app-shell recruiter-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand shell-brand" href="/">
            <Logo size={32} />
            <span>CareerHub <small>Nhà tuyển dụng</small></span>
          </Link>
          <AccountNavigation />
        </div>
      </header>
      <div className="shell-body">
        {account?.role === "RECRUITER" && <aside className="sidebar recruiter-sidebar">
          <nav ref={navigationRef} className="stack" aria-label="Khu vực nhà tuyển dụng">
            {links.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return <Link key={href} href={href} className="sidebar-link" aria-current={active ? "page" : undefined}>{label}</Link>;
            })}
          </nav>
        </aside>}
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
