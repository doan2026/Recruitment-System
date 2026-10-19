"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { Flag, type LucideIcon } from "lucide-react";
import { AccountNavigation } from "./AccountNavigation";
import { Logo } from "./Logo";

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
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    const reveal = () => {
      if (cancelled || !window.matchMedia("(max-width: 980px)").matches) return;
      const nav = navigationRef.current;
      const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !active) return;
      const bounds = nav.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left) nav.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) nav.scrollLeft += item.right - bounds.right;
    };
    reveal();
    void document.fonts.ready.then(reveal);
    window.addEventListener("resize", reveal);
    return () => { cancelled = true; window.removeEventListener("resize", reveal); };
  }, [pathname, showNavigation]);
  const initials = (name || title).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
  return <div className={`app-shell workspace-shell ${role === "candidate" ? "candidate-workspace" : `${role}-shell`}`}>
    <header className="topbar workspace-header"><div className="topbar-inner">
      <Link className="brand shell-brand" href="/" aria-label="CareerHub - Trang chủ"><Logo size={34} /><span>CareerHub<small>{title}</small></span></Link>
      <AccountNavigation workspace />
    </div></header>
    <div className="workspace-body">
      {showNavigation && <aside className={`workspace-sidebar ${role}-sidebar`}>
        <div className="workspace-identity">
          {avatarUrl ? <img className="workspace-avatar" src={avatarUrl} alt="Ảnh đại diện" /> : <span className="workspace-avatar" aria-hidden="true">{initials}</span>}
          <div><strong>{name || title}</strong><span>{title}</span></div>
        </div>
        <p className="workspace-nav-label">Không gian làm việc</p>
        <nav ref={navigationRef} className={`workspace-navigation ${role === "candidate" ? "candidate-side-nav" : ""}`} aria-label={navigationLabel}>
          {links.map(({ href, label, icon: Icon, exact, aliases }) => {
            const active = pathname === href || (!exact && pathname.startsWith(href + "/")) || !!aliases?.some(alias => pathname.startsWith(alias));
            return <Link key={href} className="workspace-nav-link" href={href} aria-current={active ? "page" : undefined}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></Link>;
          })}
          {role !== "admin" && <Link href="/reports" className="workspace-nav-link workspace-report-link" aria-current={pathname === "/reports" ? "page" : undefined}><Flag size={19} strokeWidth={1.7} aria-hidden="true" /><span>Báo cáo vi phạm</span></Link>}
        </nav>
      </aside>}
      <div className={`workspace-content ${role === "candidate" ? "candidate-content" : "content"}`}><div className="workspace-page">{children}</div><footer className="workspace-footer">CareerHub · Kết nối cơ hội, phát triển sự nghiệp</footer></div>
    </div>
  </div>;
}
