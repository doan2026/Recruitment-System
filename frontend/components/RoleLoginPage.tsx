"use client";

import Link from "next/link";
import { AuthFrame, GoogleAuthButton, PasswordToggle } from "./AuthFrame";
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
  const [registerHref, setRegisterHref] = useState("/recruiter/register");

  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (portal === "RECRUITER" && returnTo) setRegisterHref(`/recruiter/register?returnTo=${encodeURIComponent(loginDestination(portal, returnTo))}`);
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
  return <AuthFrame portal={portal} title={content.title} description={content.subtitle}>
    <form className="auth-form" noValidate onSubmit={submit}>
      <div className="auth-field">
        <label htmlFor={`${portal}-email`}>{content.emailLabel}</label>
        <input id={`${portal}-email`} type="email" autoComplete="username" maxLength={320} placeholder={isAdmin ? "Nhập email quản trị" : "name@company.com"} value={email} disabled={pending} onChange={event => setEmail(event.target.value)} aria-invalid={!!error} aria-describedby={error ? "portal-login-error" : undefined} />
      </div>
      <div className="auth-field">
        <label htmlFor={`${portal}-password`}>Mật khẩu</label>
        <div className="auth-input-wrap">
          <input id={`${portal}-password`} type={visible ? "text" : "password"} autoComplete="current-password" maxLength={128} placeholder="Nhập mật khẩu" value={password} disabled={pending} onChange={event => setPassword(event.target.value)} aria-invalid={!!error} aria-describedby={error ? "portal-login-error" : undefined} />
          <PasswordToggle visible={visible} onToggle={() => setVisible(value => !value)} disabled={pending} />
        </div>
      </div>
      <div className="auth-options">
        <label><input type="checkbox" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} /><span>Ghi nhớ đăng nhập</span></label>
        <Link href={`/forgot-password?role=${portal}`}>Quên mật khẩu?</Link>
      </div>
      {error ? <p id="portal-login-error" className="auth-error" role="alert">{error}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    </form>
    {isAdmin ? <p className="auth-message">Sử dụng tài khoản quản trị được cấp. Không chia sẻ thông tin đăng nhập với người khác.</p> : <>
      <div className="auth-divider"><span>Hoặc tiếp tục với</span></div>
      <GoogleAuthButton href="/auth/google?role=RECRUITER" label="Đăng nhập với Google" disabled={pending} onUnavailable={() => setError("Đăng nhập Google chưa được cấu hình cho môi trường này.")} />
      <p className="auth-signup">Chưa có tài khoản? <Link href={registerHref}>Đăng ký ngay</Link></p>
    </>}
  </AuthFrame>;
}
