"use client";

import Link from "next/link";
import { useState } from "react";
import { useCurrentAccount } from "./SessionGate";
import { signOut } from "../lib/authSession";
import { isDemoPerson2Api } from "../lib/person2Api";
import { toUserMessage } from "../lib/apiClient";

const publicLinks = [
  { label: "Trang chủ", href: "/" }, { label: "Việc làm", href: "/candidate/jobs" },
  { label: "Doanh nghiệp", href: "/companies" },
];
const candidateLinks = [
  { label: "Ứng tuyển của tôi", href: "/candidate/applications" },
  { label: "Đã lưu", href: "/candidate/bookmarks" }, { label: "CV của tôi", href: "/candidate/profile/cvs" },
  { label: "AI Assistant", href: "/ai" },
];
const recruiterLinks = [
  { label: "Tuyển dụng", href: "/recruiter/jobs" },
  { label: "Ứng viên gợi ý", href: "/recruiter/candidate-recommendations" }, { label: "Dashboard", href: "/recruiter/dashboard" },
  { label: "Hồ sơ công ty", href: "/recruiter/company" }, { label: "Nhận lời mời", href: "/recruiter/invitations/accept" },
];

export function AccountNavigation() {
  const account = useCurrentAccount();
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
      {links.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
    </nav>
    <div className="profile-chip">
      {isDemoPerson2Api ? <span>Chế độ demo</span> : account ? <>
        <span className="profile-copy"><strong>{account.email}</strong><small>{account.role === "RECRUITER" ? "Nhà tuyển dụng" : account.role === "CANDIDATE" ? "Ứng viên" : "Quản trị viên"}</small></span>
        <button className="btn" type="button" disabled={pending} onClick={() => void logout()}>Đăng xuất</button>
      </> : <Link className="btn btn-primary" href="/login">Đăng nhập</Link>}
    </div>
    {error ? <p className="notice notice-warning" role="alert">{error}</p> : null}
  </>;
}
