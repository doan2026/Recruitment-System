"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Flag, Menu, X, type LucideIcon } from "lucide-react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";
import { portalHome, portalSection, type AccountRole } from "@/lib/portalRoutes";

export interface WorkspaceLink { href: string; label: string; icon: LucideIcon; exact?: boolean; aliases?: string[] }
const WorkspaceContext = createContext(false);

export function WorkspaceShell(props: {
  children: ReactNode; role: "candidate" | "recruiter" | "admin"; title: string;
  navigationLabel: string; links: WorkspaceLink[]; showNavigation: boolean;
  name?: string; avatarUrl?: string | null;
}) {
  const nested = useContext(WorkspaceContext);
  if (nested) return <>{props.children}</>;
  return <WorkspaceContext.Provider value={true}><WorkspaceContent {...props} /></WorkspaceContext.Provider>;
}

function WorkspaceContent({ children, role, title, navigationLabel, links, showNavigation, name, avatarUrl }: Parameters<typeof WorkspaceShell>[0]) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const roleKey = role.toUpperCase() as AccountRole;
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); }
      if (event.key === "Tab") {
        const links = navigationRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
        const first = links?.[0];
        const last = links?.[links.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); menuButton.current?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); menuButton.current?.focus(); }
        else if (document.activeElement === menuButton.current) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"], a')?.focus();
    return () => { window.removeEventListener("keydown", close); document.body.style.overflow = previousOverflow; };
  }, [menuOpen]);
  const initials = (name || title).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
  return <div data-portal={role} className={`app-shell workspace-shell ${role === "candidate" ? "candidate-workspace" : `${role}-shell`} ${menuOpen ? "workspace-menu-open" : ""}`}>
    <a className="skip-link" href="#workspace-content">Bỏ qua điều hướng</a>
    <header className="topbar workspace-header"><div className="topbar-inner">
      {showNavigation && <button ref={menuButton} type="button" className="workspace-menu-button notification-bell" aria-label={menuOpen ? "Đóng menu" : "Mở menu"} aria-expanded={menuOpen} aria-controls="workspace-sidebar" onClick={() => setMenuOpen(open => !open)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>}
      <Link prefetch={false} className="brand shell-brand" href={portalHome(roleKey)} aria-label="CareerHub - Trang chủ"><Logo size={34} /><span>CareerHub<small>{title}</small></span></Link>
      <AccountNavigation workspace portal={roleKey} />
    </div></header>
    <div className="workspace-body">
      {menuOpen && <button className="workspace-menu-overlay" type="button" aria-label="Đóng menu điều hướng" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} />}
      {showNavigation && <aside id="workspace-sidebar" className={`workspace-sidebar ${role}-sidebar`}>
        <div className="workspace-identity">
          {avatarUrl ? <img className="workspace-avatar" width={42} height={42} decoding="async" src={avatarUrl} alt="Ảnh đại diện" /> : <span className="workspace-avatar" aria-hidden="true">{initials}</span>}
          <div><strong>{name || title}</strong><span>{title}</span></div>
        </div>
        <p className="workspace-nav-label">Không gian làm việc</p>
        <nav ref={navigationRef} className={`workspace-navigation ${role === "candidate" ? "candidate-side-nav" : ""}`} aria-label={navigationLabel}>
          {links.map(({ href, label, icon: Icon, exact, aliases }) => {
            const active = pathname === href || (!exact && pathname.startsWith(href + "/")) || !!aliases?.some(alias => pathname.startsWith(alias));
            return <Link prefetch={false} key={href} className="workspace-nav-link" href={href} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></Link>;
          })}
          {role !== "admin" && <Link prefetch={false} href={portalSection(roleKey, "reports")} className="workspace-nav-link workspace-report-link" aria-current={pathname === portalSection(roleKey, "reports") ? "page" : undefined} onClick={() => setMenuOpen(false)}><Flag size={19} strokeWidth={1.7} aria-hidden="true" /><span>Báo cáo vi phạm</span></Link>}
        </nav>
      </aside>}
      <div id="workspace-content" tabIndex={-1} className={`workspace-content ${role === "candidate" ? "candidate-content" : "content"}`}><div className="workspace-page">{children}</div><footer className="workspace-footer"><span>CareerHub · {title}</span><span>Cùng bạn tiến xa hơn mỗi ngày.</span></footer></div>
    </div>
  </div>;
}
