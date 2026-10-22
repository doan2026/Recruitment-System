import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import styles from "./AuthFrame.module.css";
import { portalEntry } from "@/lib/portalRoutes";

type AuthPortal = "CANDIDATE" | "RECRUITER" | "ADMIN";
const portals = {
  CANDIDATE: {
    label: "Ứng viên", href: "/login", heading: "Bước tiếp theo trong sự nghiệp của bạn.",
    description: "Một nơi để hoàn thiện hồ sơ, tìm công việc phù hợp và theo dõi từng cơ hội.",
    steps: ["Xây dựng hồ sơ và CV", "Khám phá cơ hội phù hợp", "Theo dõi ứng tuyển và phỏng vấn"],
  },
  RECRUITER: {
    label: "Nhà tuyển dụng", href: "/recruiter/login", heading: "Kết nối với những ứng viên phù hợp.",
    description: "Quản lý công ty, tin tuyển dụng và hành trình ứng viên trong cùng một không gian.",
    steps: ["Hoàn thiện hồ sơ công ty", "Đăng và quản lý tin tuyển dụng", "Kết nối, phỏng vấn và tuyển dụng"],
  },
  ADMIN: {
    label: "Quản trị viên", href: "/admin/login", heading: "Cùng xây dựng cộng đồng nghề nghiệp đáng tin cậy.",
    description: "Không gian quản trị dành cho nhân sự được cấp quyền vận hành CareerHub.",
    steps: ["Xác minh hồ sơ công ty", "Kiểm duyệt tin tuyển dụng", "Theo dõi và xử lý báo cáo"],
  },
} as const;

export function AuthFrame({ portal = "CANDIDATE", title, description, children }: {
  portal?: AuthPortal; title: string; description: string; children: ReactNode;
}) {
  const context = portals[portal];
  return <main className={styles.frame} data-auth-frame={portal.toLowerCase()}>
    <header className={styles.header}>
      <Link className={styles.brand} href={portalEntry(portal)} aria-label="CareerHub - Trang chủ"><Logo size={36} /><span>CareerHub</span></Link>
      <Link className={styles.explore} href={portal === "CANDIDATE" ? "/candidate/jobs" : portalEntry(portal)}>{portal === "CANDIDATE" ? "Khám phá việc làm" : portal === "RECRUITER" ? "Trang chủ tuyển dụng" : "Khu vực quản trị"} <span aria-hidden="true">↗</span></Link>
    </header>
    <div className={styles.layout}>
      <aside className={styles.context}>
        <span className={styles.contextLabel}>CAREERHUB · {context.label.toLocaleUpperCase("vi-VN")}</span>
        <h2>{context.heading}</h2>
        <p>{context.description}</p>
        <ul>{context.steps.map(step => <li key={step}><span aria-hidden="true">✓</span>{step}</li>)}</ul>
        <div className={styles.contextFooter}>Kết nối cơ hội. Phát triển sự nghiệp.</div>
      </aside>
      <section className={styles.card}>
        <div className={styles.portalBadge}>{context.label}</div>
        <header className={styles.heading}><h1>{title}</h1><p>{description}</p></header>
        <div className={styles.content}>{children}</div>
      </section>
    </div>
    <footer className={styles.footer}><span>© 2026 CareerHub</span><span>{portal === "CANDIDATE" ? "Cơ hội phù hợp. Tương lai rộng mở." : portal === "RECRUITER" ? "Kết nối nhân tài. Xây dựng đội ngũ." : "Không gian vận hành hệ thống"}</span></footer>
  </main>;
}

export function PasswordToggle({ visible, onToggle, disabled = false }: { visible: boolean; onToggle: () => void; disabled?: boolean }) {
  return <button className="auth-visibility" type="button" onClick={onToggle} disabled={disabled} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible}>{visible ? "Ẩn" : "Hiện"}</button>;
}

export function GoogleAuthButton({ href, label, onUnavailable, disabled = false }: { href: string; label: string; onUnavailable: () => void; disabled?: boolean }) {
  const content = <><img src="/figma/login/bc562.svg" width={20} height={20} alt="" aria-hidden="true" /><span>{label}</span></>;
  return process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true" && !disabled
    ? <a className="auth-google" href={href}>{content}</a>
    : <button className="auth-google" type="button" onClick={onUnavailable} disabled={disabled}>{content}</button>;
}
