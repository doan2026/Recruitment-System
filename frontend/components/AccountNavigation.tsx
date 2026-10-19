"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, MessageSquare } from "lucide-react";
import { useCurrentAccount } from "./SessionGate";
import { signOut } from "../lib/authSession";
import { isDemoPerson2Api } from "../lib/person2Api";
import { loginRoute } from "../lib/person1Api";
import { useNotifications } from "./NotificationProvider";

const publicLinks = [
  { label: "Trang chủ", href: "/" }, { label: "Việc làm", href: "/candidate/jobs" },
  { label: "Doanh nghiệp", href: "/companies" },
];
export function NotificationBell() {
  const { unreadCount } = useNotifications();
  return <Link href="/notifications" aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"} title="Thông báo" className="notification-bell">
    <Bell size={20} strokeWidth={1.7} aria-hidden="true" />
    {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
  </Link>;
}
export function AccountNavigation({ workspace = false }: { workspace?: boolean }) {
  const account = useCurrentAccount();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const home = account?.role === "RECRUITER" ? "/recruiter/dashboard" : account?.role === "ADMIN" ? "/admin" : "/candidate/dashboard";
  const links = [...publicLinks, ...(!workspace && account ? [{ label: "Không gian của tôi", href: home }] : [])];
  async function logout() {
    if (pending) return;
    const destination = loginRoute(account?.role ?? "CANDIDATE");
    setPending(true);
    try { await signOut(); router.replace(destination); }
    catch { router.replace(destination + "?logout=unconfirmed"); }
    finally { setPending(false); }
  }
  return <>
    <nav className="top-nav" aria-label="Điều hướng chính">
      {links.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}
    </nav>
    <div className="profile-chip">
      {account && <><NotificationBell />{account.role !== "ADMIN" && <Link className="notification-bell" href="/messages" aria-label="Tin nhắn" title="Tin nhắn"><MessageSquare size={20} strokeWidth={1.7} aria-hidden="true" /></Link>}</>}
      {isDemoPerson2Api ? <span className="badge badge-info">Chế độ demo</span> : account ? <button className="btn" type="button" disabled={pending} onClick={() => void logout()}>{pending ? "Đang thoát…" : "Đăng xuất"}</button> : <><Link className="btn btn-ghost recruiter-entry" href="/recruiter/login">Nhà tuyển dụng</Link><Link className="btn btn-primary" href="/login">Đăng nhập</Link></>}
    </div>
  </>;
}
