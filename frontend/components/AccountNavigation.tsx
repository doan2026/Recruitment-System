"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, MessageSquare, LogOut, Plus, ArrowUpRight } from "lucide-react";
import { useCurrentAccount } from "./SessionGate";
import { signOut } from "../lib/authSession";
import { portalHome, portalLabel, portalSection, type AccountRole } from "../lib/portalRoutes";
import { useNotifications } from "./NotificationProvider";

export function NotificationBell() {
  const account = useCurrentAccount();
  const { unreadCount } = useNotifications();
  return <Link prefetch={false} href={portalSection(account?.role ?? "CANDIDATE", "notifications")} aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"} title="Thông báo" className="notification-bell">
    <Bell size={20} strokeWidth={1.7} aria-hidden="true" />
    {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
  </Link>;
}

export function AccountNavigation({ workspace = false, portal = "CANDIDATE" }: { workspace?: boolean; portal?: AccountRole }) {
  const account = useCurrentAccount();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const role = account?.role ?? portal;
  const candidateLinks = [{ label: "Trang chủ", href: "/" }, { label: "Tìm việc làm", href: "/candidate/jobs" }, { label: "Công ty", href: account?.role === "CANDIDATE" ? "/candidate/companies" : "/companies" }];
  const links = workspace ? role === "CANDIDATE" ? candidateLinks : [{ label: "Trang chủ", href: portalHome(role) }]
    : portal === "RECRUITER" ? [{ label: "Trang chủ", href: "/recruiter" }, { label: "Giải pháp tuyển dụng", href: "/recruiter#solutions" }, { label: "Quy trình", href: "/recruiter#how-it-works" }]
      : candidateLinks;
  async function logout() {
    if (pending) return;
    const destination = role === "ADMIN" ? "/admin/login" : role === "RECRUITER" ? "/recruiter/login" : "/login";
    setPending(true);
    try { await signOut(); router.replace(destination); }
    catch { router.replace(destination + "?logout=unconfirmed"); }
    finally { setPending(false); }
  }
  return <>
    <nav className="top-nav" aria-label="Điều hướng chính">
      {account === undefined ? <span className="account-skeleton" aria-hidden="true" /> : links.map(item => <Link prefetch={false} key={item.href} href={item.href} aria-current={pathname === item.href || (/\/(?:companies|jobs)$/.test(item.href) && pathname.startsWith(item.href + "/")) ? "page" : undefined}>{item.label}</Link>)}
    </nav>
    <div className="profile-chip">
      {account === undefined ? <span className="account-skeleton" aria-label="Đang kiểm tra tài khoản" /> : account ? <>
        {role === "RECRUITER" && <Link className="btn btn-primary header-create-job" href="/recruiter/jobs/new"><Plus size={17} aria-hidden="true" />Đăng tin</Link>}
        <NotificationBell />
        {role !== "ADMIN" && <Link prefetch={false} className="notification-bell" href={portalSection(role, "messages")} aria-label="Tin nhắn" title="Tin nhắn"><MessageSquare size={20} strokeWidth={1.7} aria-hidden="true" /></Link>}
        <Link prefetch={false} className="account-identity" href={role === "CANDIDATE" ? "/candidate/profile" : role === "RECRUITER" ? "/recruiter/company" : "/admin"} title={account.email}>
          <span className="account-avatar" aria-hidden="true">{account.email.slice(0, 1).toUpperCase()}</span><span className="account-copy"><strong>{account.email.split("@")[0]}</strong><small>{portalLabel(role)}</small></span>
        </Link>
        <button className="notification-bell logout-button" type="button" disabled={pending} onClick={() => void logout()} aria-label={pending ? "Đang thoát…" : "Đăng xuất"} title="Đăng xuất"><LogOut size={19} aria-hidden="true" /></button>
      </> : <>
        {portal === "CANDIDATE" && <Link prefetch={false} className="recruiter-entry portal-switch" href="/recruiter">Nhà tuyển dụng <ArrowUpRight size={14} aria-hidden="true" /></Link>}
        <Link className="btn btn-ghost" href={portal === "RECRUITER" ? "/recruiter/login" : portal === "ADMIN" ? "/admin/login" : "/login"}>Đăng nhập</Link>
        {portal !== "ADMIN" && <Link className="btn btn-primary" href={portal === "RECRUITER" ? "/recruiter/register" : "/register"}>Đăng ký</Link>}
      </>}
    </div>
  </>;
}
