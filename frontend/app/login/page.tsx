"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthFrame, GoogleAuthButton, PasswordToggle } from "../../components/AuthFrame";
import { signIn, signOut } from "../../lib/authSession";
import { toUserMessage } from "../../lib/apiClient";
import { loginDestination } from "../../lib/person1Api";

const rememberedEmailKey = "careerhub.remembered-login-email";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [registerHref, setRegisterHref] = useState("/register");

  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (returnTo) setRegisterHref(`/register?returnTo=${encodeURIComponent(loginDestination("CANDIDATE", returnTo))}`);
    if (new URLSearchParams(window.location.search).get("logout") === "unconfirmed") {
      setError("Đã xóa phiên trên trình duyệt; máy chủ chưa xác nhận thu hồi phiên cũ. Bạn có thể đăng nhập lại.");
    }
    try {
      const savedEmail = window.localStorage.getItem(rememberedEmailKey);
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberEmail(true);
      }
    } catch {
      // Storage can be disabled; login remains fully usable without it.
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Nhập địa chỉ email hợp lệ.");
      document.getElementById("login-email")?.focus();
      return;
    }
    if (!password) {
      setError("Nhập mật khẩu của bạn.");
      document.getElementById("login-password")?.focus();
      return;
    }

    setPending(true);
    try {
      const account = await signIn(normalizedEmail, password);
      if (account.role !== "CANDIDATE") {
        await signOut().catch(() => undefined);
        setError("Trang này dành cho ứng viên. Hãy dùng đúng trang đăng nhập theo vai trò tài khoản.");
        setPassword("");
        return;
      }
      try {
        if (rememberEmail) window.localStorage.setItem(rememberedEmailKey, normalizedEmail);
        else window.localStorage.removeItem(rememberedEmailKey);
      } catch {
        // Never store credentials or session tokens in browser storage.
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

  return <AuthFrame portal="CANDIDATE" title="Chào mừng quay lại" description="Đăng nhập để tìm việc, quản lý hồ sơ và theo dõi cơ hội của bạn.">
    <form className="auth-form" noValidate onSubmit={submit}>
      <div className="auth-field">
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" autoComplete="username" maxLength={320} placeholder="Nhập địa chỉ email" value={email} disabled={pending} onChange={event => setEmail(event.target.value)} aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} />
      </div>
      <div className="auth-field">
        <label htmlFor="login-password">Mật khẩu</label>
        <div className="auth-input-wrap">
          <input id="login-password" type={visible ? "text" : "password"} autoComplete="current-password" maxLength={128} placeholder="Nhập mật khẩu" value={password} disabled={pending} onChange={event => setPassword(event.target.value)} aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} />
          <PasswordToggle visible={visible} onToggle={() => setVisible(value => !value)} disabled={pending} />
        </div>
      </div>
      <div className="auth-options">
        <label><input type="checkbox" checked={rememberEmail} disabled={pending} onChange={event => setRememberEmail(event.target.checked)} /><span>Ghi nhớ đăng nhập</span></label>
        <Link href="/forgot-password">Quên mật khẩu?</Link>
      </div>
      {error ? <p id="login-error" className="auth-error" role="alert">{error}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    </form>
    <div className="auth-divider"><span>Hoặc tiếp tục với</span></div>
    <GoogleAuthButton href="/auth/google" label="Đăng nhập với Google" disabled={pending} onUnavailable={() => setError("Đăng nhập Google chưa được cấu hình cho môi trường này.")} />
    <p className="auth-signup">Chưa có tài khoản? <Link href={registerHref}>Đăng ký ngay</Link></p>
  </AuthFrame>;
}
