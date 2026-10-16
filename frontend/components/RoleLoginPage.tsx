"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { signIn, signOut } from "../lib/authSession";
import { toUserMessage } from "../lib/apiClient";
import { loginDestination } from "../lib/person1Api";

type Portal = "RECRUITER" | "ADMIN";

const portalContent: Record<Portal, { title: string; subtitle: string; home: string; emailLabel: string }> = {
  RECRUITER: {
    title: "Đăng nhập Recruiter",
    subtitle: "Đăng nhập để quản lý tin tuyển dụng và ứng viên.",
    home: "/recruiter/jobs",
    emailLabel: "Email công việc",
  },
  ADMIN: {
    title: "Đăng nhập quản trị",
    subtitle: "Cổng quản trị dành riêng cho nhân sự được cấp quyền CareerHub.",
    home: "/admin",
    emailLabel: "Email quản trị",
  },
};

export default function RoleLoginPage({ portal }: { portal: Portal }) {
  const router = useRouter();
  const content = portalContent[portal];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("logout") === "unconfirmed") {
      setError("Đã xóa phiên trên trình duyệt; máy chủ chưa xác nhận thu hồi phiên cũ. Bạn có thể đăng nhập lại.");
    }
    try {
      const saved = window.localStorage.getItem(`careerhub.remembered-login-email:${portal.toLowerCase()}`);
      setEmail(saved ?? "");
      setRemember(!!saved);
    } catch {
      // Login remains usable when storage is unavailable.
    }
  }, [portal]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Nhập địa chỉ email hợp lệ.");
      return;
    }
    if (!password) {
      setError("Nhập mật khẩu của bạn.");
      return;
    }
    setPending(true);
    try {
      const account = await signIn(email.trim(), password);
      if (account.role !== portal) {
        await signOut().catch(() => undefined);
        const actualRole = account.role === "CANDIDATE" ? "ứng viên" : account.role === "RECRUITER" ? "nhà tuyển dụng" : "quản trị viên";
        setError(`Tài khoản này thuộc vai trò ${actualRole}. Hãy dùng đúng trang đăng nhập.`);
        setPassword("");
        return;
      }
      try {
        const key = `careerhub.remembered-login-email:${portal.toLowerCase()}`;
        if (remember) window.localStorage.setItem(key, email.trim());
        else window.localStorage.removeItem(key);
      } catch {
        // Login works when browser storage is unavailable.
      }
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      router.replace(loginDestination(account.role, returnTo));
    } catch (reason) {
      setError(toUserMessage(reason));
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  const isAdmin = portal === "ADMIN";
  if (isAdmin) return <main className="auth-admin-page" data-node-id="54:224">
    <section className="auth-admin-panel" data-node-id="54:225">
      <header className="auth-admin-brand-row">
        <div className="auth-admin-wordmark" aria-label="CareerHub - Quản trị hệ thống"><span className="auth-admin-logo-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M20 1 29 10 20 19 11 10 20 1Z" fill="#007357"/><path d="M39 20 30 29 21 20 30 11 39 20Z" fill="#00a878"/><path d="M20 39 11 30 20 21 29 30 20 39Z" fill="#007357"/><path d="M1 20 10 11 19 20 10 29 1 20Z" fill="#00a878"/><path d="M20 13 27 20 20 27 13 20 20 13Z" fill="#f9f9ff"/></svg></span><span><strong>CAREERHUB</strong><small>QUẢN TRỊ HỆ THỐNG</small></span></div>
        <span className="auth-admin-badge">Quản trị viên</span>
      </header>
      <div className="auth-admin-content" data-node-id="54:230">
        <header className="auth-admin-heading"><h1>Đăng nhập quản trị</h1><p>Chào mừng quay lại. Đăng nhập để quản lý và vận hành hệ thống CareerHub.</p></header>
        <form className="auth-admin-form" noValidate onSubmit={submit}>
          <div className="auth-admin-field"><label htmlFor="ADMIN-email">Email quản trị</label><div className="auth-admin-input-wrap"><img src="/figma/login/3d505.svg" alt="" aria-hidden="true"/><input id="ADMIN-email" type="email" autoComplete="username" maxLength={320} placeholder="Nhập email quản trị của bạn" value={email} onChange={event => setEmail(event.target.value)} disabled={pending}/></div></div>
          <div className="auth-admin-field"><label htmlFor="ADMIN-password">Mật khẩu</label><div className="auth-admin-input-wrap"><img src="/figma/login/8e7a1.svg" alt="" aria-hidden="true"/><input id="ADMIN-password" type={visible ? "text" : "password"} autoComplete="current-password" maxLength={128} placeholder="Nhập mật khẩu" value={password} onChange={event => setPassword(event.target.value)} disabled={pending}/><button type="button" className="auth-admin-eye" onClick={() => setVisible(value => !value)} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible}><img src="/figma/login/a44df.svg" alt=""/></button></div></div>
          <div className="auth-admin-options"><label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/><span>Ghi nhớ đăng nhập</span></label><Link href="/forgot-password">Quên mật khẩu?</Link></div>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang đăng nhập…" : <>Đăng nhập <span aria-hidden="true">→</span></>}</button>
        </form>
        <aside className="auth-admin-security"><img src="/figma/admin/fdcad.svg" alt=""/><div><strong>Chỉ dành cho quản trị viên</strong><p>Sử dụng tài khoản được cấp. Không chia sẻ thông tin đăng nhập với người khác.</p></div></aside>
        <div className="auth-admin-support"><span>Bạn cần hỗ trợ truy cập?</span><a href="mailto:support@careerhub.local">Liên hệ bộ phận kỹ thuật</a></div>
      </div>
      <footer className="auth-admin-footer"><span>© 2024 CareerHub</span><div><a href="mailto:support@careerhub.local">Trợ giúp</a><Link href="/privacy">Bảo mật</Link></div></footer>
    </section>
    <aside className="auth-admin-visual"><div className="auth-admin-visual-chip"><img src="/figma/admin/fdcad.svg" alt="" aria-hidden="true"/>Cổng quản trị CareerHub</div><div className="auth-admin-visual-card"><h2>Cùng xây dựng một cộng đồng<br/>nghề nghiệp đáng tin cậy</h2><p>Quản lý người dùng, xác minh công ty và kiểm duyệt tin tuyển dụng — tất cả trong một không gian quản trị.</p><div><strong>CareerHub · Quản trị hệ thống</strong><span>Chỉ sử dụng nội bộ</span></div></div></aside>
  </main>;
  return (
    <main className="auth-portal-page auth-recruiter-portal">
      <header className="auth-recruiter-login-brand"><Link href="/" aria-label="CareerHub"><img src="/figma/login/6aca2.png" alt="CareerHub" width="117" height="32"/></Link></header>

      <section className="auth-portal-main">
        <div className="auth-portal-card">
          <header className="auth-portal-heading">
            <h1>{content.title}</h1>
            <p>{content.subtitle}</p>
          </header>
          <form className="auth-portal-form" noValidate onSubmit={submit}>
            <div className="auth-portal-field">
              <label htmlFor={`${portal}-email`}>{content.emailLabel}</label>
              <div className="auth-portal-input-wrap">
                <img src="/figma/login/3d505.svg" alt="" aria-hidden="true" />
                <input id={`${portal}-email`} type="email" autoComplete="username" maxLength={320} placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} />
              </div>
            </div>
            <div className="auth-portal-field">
              <label htmlFor={`${portal}-password`}>Mật khẩu</label>
              <div className="auth-portal-input-wrap">
                <img className="auth-portal-lock" src="/figma/login/8e7a1.svg" alt="" aria-hidden="true" />
                <input id={`${portal}-password`} type={visible ? "text" : "password"} autoComplete="current-password" maxLength={128} placeholder="Nhập mật khẩu" value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} />
                <button className="auth-portal-eye" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible}>
                  <img src="/figma/login/a44df.svg" alt="" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="auth-portal-options">
              <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Ghi nhớ đăng nhập</span></label>
              <Link href="/forgot-password">Quên mật khẩu?</Link>
            </div>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang đăng nhập…" : "Đăng nhập"}</button>
          </form>
          <>
            <div className="auth-portal-divider"><span>HOẶC</span></div>
            {process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true" ? (
              <a className="auth-google" href="/auth/google?role=RECRUITER"><img src="/figma/login/bc562.svg" alt="" aria-hidden="true" /><span>Đăng nhập với Google</span></a>
            ) : (
              <button className="auth-google" type="button" onClick={() => setError("Đăng nhập Google chưa được cấu hình cho môi trường local.")}><img src="/figma/login/bc562.svg" alt="" aria-hidden="true" /><span>Đăng nhập với Google</span></button>
            )}
            <p className="auth-portal-signup">Chưa có tài khoản? <Link href="/recruiter/register">Đăng ký ngay</Link></p>
          </>
        </div>
      </section>

      <footer className="auth-portal-footer auth-recruiter-login-footer">
        <Link href="/" aria-label="CareerHub"><img src="/figma/login/7544b.png" alt="CareerHub" width="92" height="26" /></Link>
        <div><Link href="/companies">Company</Link><a href="mailto:support@careerhub.local">Support</a><Link href="/privacy">Legal</Link></div>
        <span>© 2024 CareerHub. All rights reserved.</span>
      </footer>
    </main>
  );
}


