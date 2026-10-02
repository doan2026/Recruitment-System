"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { signIn, signOut } from "../lib/authSession";
import { toUserMessage } from "../lib/apiClient";
import { landing } from "../lib/person1Api";

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
      const prefix = portal === "ADMIN" ? "/admin" : "/recruiter";
      const safeReturn = returnTo?.startsWith(`${prefix}/`) && !returnTo.includes("\\") ? returnTo : content.home;
      router.replace(safeReturn);
    } catch (reason) {
      setError(toUserMessage(reason));
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  const isAdmin = portal === "ADMIN";
  return (
    <main className={`auth-portal-page ${isAdmin ? "auth-admin-portal" : "auth-recruiter-portal"}`}>
      <header className="auth-portal-header">
        <Link className="auth-portal-brand" href="/" aria-label="CareerHub - Trang chủ">
          <img src="/figma/login/6aca2.png" alt="CareerHub" width="146" height="40" />
        </Link>
        <nav aria-label="Điều hướng">
          {!isAdmin ? <><span>Bạn là ứng viên?</span><Link href="/login">Đăng nhập ứng viên</Link></> : <span>Khu vực quản trị bảo mật</span>}
        </nav>
      </header>

      <section className="auth-portal-main">
        <div className="auth-portal-card">
          {isAdmin ? <div className="auth-admin-mark" aria-hidden="true">CH</div> : null}
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
          {!isAdmin ? <>
            <div className="auth-portal-divider"><span>HOẶC</span></div>
            {process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true" ? (
              <a className="auth-google" href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"}/auth/google?role=RECRUITER`}><img src="/figma/login/bc562.svg" alt="" aria-hidden="true" /><span>Đăng nhập với Google</span></a>
            ) : (
              <button className="auth-google" type="button" onClick={() => setError("Đăng nhập Google chưa được cấu hình cho môi trường local.")}><img src="/figma/login/bc562.svg" alt="" aria-hidden="true" /><span>Đăng nhập với Google</span></button>
            )}
            <p className="auth-portal-signup">Chưa có tài khoản? <Link href="/recruiter/register">Đăng ký ngay</Link></p>
          </> : <p className="auth-admin-help">Tài khoản quản trị do hệ thống cấp. Không có đăng ký công khai.</p>}
        </div>
      </section>

      <footer className="auth-portal-footer">
        <Link href="/" aria-label="CareerHub"><img src="/figma/login/7544b.png" alt="CareerHub" width="92" height="26" /></Link>
        <div><a href="mailto:support@careerhub.local">Support</a><Link href="/privacy">Legal</Link></div>
        <span>© 2024 CareerHub. All rights reserved.</span>
      </footer>
    </main>
  );
}


