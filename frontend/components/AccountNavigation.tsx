"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useCurrentAccount } from "./SessionGate";
import { signOut } from "../lib/authSession";
import { isDemoPerson2Api } from "../lib/person2Api";
import { toUserMessage } from "../lib/apiClient";
import { useNotifications } from "./NotificationProvider";

const publicLinks = [
  { label: "Trang chủ", href: "/" }, { label: "Việc làm", href: "/candidate/jobs" },
  { label: "Doanh nghiệp", href: "/companies" },
];
const candidateLinks = [
  { label: "Ứng tuyển của tôi", href: "/candidate/applications" },
  { label: "Đã lưu", href: "/candidate/bookmarks" }, { label: "CV của tôi", href: "/candidate/profile/cvs" },
  { label: "Trợ lý AI", href: "/ai" },
];
const recruiterLinks = [
  { label: "Tuyển dụng", href: "/recruiter/jobs" },
  { label: "Ứng viên gợi ý", href: "/recruiter/candidate-recommendations" }, { label: "Tổng quan", href: "/recruiter/dashboard" },
  { label: "Hồ sơ công ty", href: "/recruiter/company" }, { label: "Nhận lời mời", href: "/recruiter/invitations/accept" },
];

export function NotificationBell() {
  const { unreadCount } = useNotifications();
  return (
    <Link href="/notifications" aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"} className="notification-bell" style={{ position: "relative", color: "var(--text)" }}>
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      {unreadCount > 0 && (
        <span className="badge badge-danger" style={{ position: "absolute", top: -8, right: -8, fontSize: "10px", padding: "2px 4px", minHeight: "16px", borderRadius: "8px" }}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

export function AccountNavigation() {
  const account = useCurrentAccount();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const links = [...publicLinks,
    ...(account?.role === "CANDIDATE" ? [{ label: "Hồ sơ", href: "/candidate/profile" }] : []),
    ...(account?.role === "ADMIN" ? [{ label: "Quản trị", href: "/admin" }] : []),
    ...(account ? [{ label: "Báo cáo vi phạm", href: "/reports" }] : []),
    ...(isDemoPerson2Api || account?.role === "CANDIDATE" ? candidateLinks : []),
    ...(isDemoPerson2Api || account?.role === "RECRUITER" ? recruiterLinks : []),
  ];
  async function logout() {
    if (pending) return;
    setPending(true); setError("");
    try { await signOut(); }
    catch (reason) { setError(`Đã xóa phiên trên trình duyệt; chưa xác nhận thu hồi phiên máy chủ. ${toUserMessage(reason)}`); }
    finally { setPending(false); }
  }
  return <>
    <nav className="top-nav" aria-label="Điều hướng chính">
      {links.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}
    </nav>
    <div className="profile-chip" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      {account && <NotificationBell />}
      {isDemoPerson2Api ? <span>Chế độ demo</span> : account ? <>
        <span className="profile-copy"><strong>{account.email}</strong><small>{account.role === "RECRUITER" ? "Nhà tuyển dụng" : account.role === "CANDIDATE" ? "Ứng viên" : "Quản trị viên"}</small></span>
        <button className="btn" type="button" disabled={pending} onClick={() => void logout()}>Đăng xuất</button>
      </> : <Link className="btn btn-primary" href="/login">Đăng nhập</Link>}
    </div>
    {error ? <p className="notice notice-warning" role="alert">{error}</p> : null}
  </>;
}
