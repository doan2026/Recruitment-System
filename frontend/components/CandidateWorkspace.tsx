"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useCurrentAccount } from "./SessionGate";
import { requestApi } from "../lib/apiClient";
import { signOut } from "../lib/authSession";
import type { CandidateProfile } from "../lib/person1Api";
import { isDemoPerson2Api } from "../lib/person2Api";
import { PublicShell } from "./PublicShell";
import { NotificationBell } from "./AccountNavigation";

const links = [
  { label: "Tổng quan", href: "/candidate/dashboard", icon: "▦" },
  { label: "Tìm việc", href: "/candidate/jobs", icon: "⌕" },
  { label: "Việc làm đã lưu", href: "/candidate/bookmarks", icon: "♡" },
  { label: "Đơn ứng tuyển", href: "/candidate/applications", icon: "▤" },
  { label: "Lịch phỏng vấn", href: "/candidate/interviews", icon: "▣" },
  { label: "Hồ sơ cá nhân", href: "/candidate/profile", icon: "♙" },
  { label: "Quản lý CV", href: "/candidate/profile/cvs", icon: "▧" },
  { label: "Gợi ý việc làm", href: "/candidate/ai/recommendations", icon: "✧" },
  { label: "Tin nhắn", href: "/messages", icon: "▤" },
  { label: "Thông báo", href: "/notifications", icon: "♧" },
  { label: "Trợ lý AI", href: "/ai", icon: "✧" },
  { label: "Cài đặt tài khoản", href: "/candidate/settings", icon: "⚙" },
];

const CandidateWorkspaceContext = createContext(false);

export function CandidateWorkspace({ children }: { children: ReactNode }) {
  const nested = useContext(CandidateWorkspaceContext);
  if (nested) return <>{children}</>;
  return <CandidateWorkspaceContext.Provider value={true}><CandidateWorkspaceContent>{children}</CandidateWorkspaceContent></CandidateWorkspaceContext.Provider>;
}

function CandidateWorkspaceContent({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    const revealActiveLink = () => {
      if (cancelled) return;
      const navigation = navigationRef.current;
      const active = navigation?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!navigation || !active || !window.matchMedia("(max-width: 680px)").matches) return;
      const bounds = navigation.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left + 12) navigation.scrollLeft += item.left - bounds.left - 12;
      else if (item.right > bounds.right - 12) navigation.scrollLeft += item.right - bounds.right + 12;
    };
    revealActiveLink();
    // Web-font metrics can change the horizontal menu width after hydration.
    void document.fonts.ready.then(revealActiveLink);
    return () => { cancelled = true; };
  }, [pathname, account?.role]);

  useEffect(() => {
    if (!account || account.role !== "CANDIDATE") { setProfile(null); return; }
    const controller = new AbortController();
    requestApi<CandidateProfile>(`/profile/${account.id}`, { privateData: true, signal: controller.signal })
      .then((result) => setProfile(result.data))
      .catch(() => { if (!controller.signal.aborted) setProfile(null); });
    return () => controller.abort();
  }, [account?.id, account?.role]);

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try { await signOut(); router.replace("/login"); }
    catch { router.replace("/login?logout=unconfirmed"); }
    finally { setLogoutBusy(false); }
  }

  if (!isDemoPerson2Api && account?.role !== "CANDIDATE") return <PublicShell>{children}</PublicShell>;

  const displayName = profile?.fullName || account?.email || "Ứng viên";
  const initials = displayName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "UV";
  return <div className="candidate-workspace">
    <aside className="candidate-sidebar">
      <Link className="candidate-logo" href="/" aria-label="CareerHub - Trang chủ"><img src="/figma/login/6aca2.png" alt="CareerHub" width="117" height="32" /></Link>
      <div className="candidate-identity">
        {profile?.avatarUrl ? <img className="candidate-avatar" src={profile.avatarUrl} alt="Ảnh đại diện" /> : <span className="candidate-avatar candidate-avatar-fallback" aria-hidden="true">{initials}</span>}
        <div><strong>{profile?.fullName || (account ? "Ứng viên" : "Chào mừng")}</strong><span>{account ? "Ứng viên" : "Tìm cơ hội phù hợp"}</span></div>
      </div>
      <nav ref={navigationRef} className="candidate-side-nav" aria-label="Khu vực ứng viên">
        {links.map((item) => {
          const active = pathname === item.href || (item.href !== "/candidate/profile" && pathname.startsWith(item.href + "/")) || (item.href === "/candidate/profile/cvs" && pathname.startsWith("/candidate/cvs/"));
          return <Link key={item.label} className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}><span className="candidate-nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></Link>;
        })}
      </nav>
    </aside>
    <div className="candidate-workspace-main">
      <header className="candidate-topbar">
        <nav aria-label="Điều hướng CareerHub"><Link href="/">Trang chủ</Link><Link href="/candidate/jobs">Việc làm</Link><Link href="/candidate/profile/cvs/builder">CV Online</Link><Link href="/companies">Công ty</Link></nav>
        <div className="candidate-top-actions"><NotificationBell /><Link className="candidate-icon-link" href="/messages" aria-label="Tin nhắn">▤</Link>{account ? <><span className="candidate-top-name">{displayName}</span><button className="candidate-signout" type="button" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "Đang thoát…" : "Đăng xuất"}</button></> : <Link className="candidate-signout" href="/login">Đăng nhập</Link>}</div>
      </header>
      <div className="candidate-content">{children}</div>
      <footer className="candidate-footer"><div><img src="/figma/login/7544b.png" alt="CareerHub" width="73" height="20" /><p>Kết nối ứng viên với những cơ hội nghề nghiệp phù hợp.</p></div><div><strong>CÔNG TY</strong><Link href="/companies">Về chúng tôi</Link></div><div><strong>ỨNG VIÊN</strong><Link href="/candidate/jobs">Tìm việc làm</Link><Link href="/candidate/profile/cvs/builder">CV Online</Link></div><div><strong>HỖ TRỢ</strong><Link href="/reports">Báo cáo vi phạm</Link></div><small>© 2026 CareerHub. Tất cả quyền được bảo lưu.</small></footer>
    </div>
  </div>;
}
