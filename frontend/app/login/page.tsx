"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true";
  const googleHref = "/auth/google";

  return (
    <main className="auth-page auth-login" data-node-id="22:2">
      <section className="auth-panel auth-login-panel">
        <div className="auth-login-content">
          <Link className="auth-brand" href="/" aria-label="CareerHub - Trang chủ">
            <img src="/figma/login/6aca2.png" alt="CareerHub" width="117" height="32" />
          </Link>

          <header className="auth-heading">
            <h1>Chào mừng quay lại</h1>
            <p>Vui lòng đăng nhập để tiếp tục hành trình phát triển sự nghiệp của bạn.</p>
          </header>

          <form className="auth-form" noValidate onSubmit={submit}>
            <div className="auth-field">
              <label htmlFor="login-email">Email</label>
              <div className="auth-input-wrap">
                <img className="auth-field-icon" src="/figma/login/3d505.svg" alt="" aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  maxLength={320}
                  placeholder="Nhập địa chỉ email"
                  value={email}
                  disabled={pending}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={!!error}
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="login-password">Mật khẩu</label>
              <div className="auth-input-wrap">
                <img className="auth-field-icon auth-lock-icon" src="/figma/login/8e7a1.svg" alt="" aria-hidden="true" />
                <input
                  id="login-password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  maxLength={128}
                  placeholder="Nhập mật khẩu"
                  value={password}
                  disabled={pending}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={!!error}
                />
                <button
                  className="auth-visibility"
                  type="button"
                  aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  aria-pressed={visible}
                  onClick={() => setVisible((value) => !value)}
                >
                  <img src="/figma/login/a44df.svg" alt="" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="auth-options">
              <label className="auth-remember">
                <input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} />
                <span>Ghi nhớ đăng nhập</span>
              </label>
              <Link href="/forgot-password">Quên mật khẩu?</Link>
            </div>

            <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>
              <span>{pending ? "Đang đăng nhập…" : "Đăng nhập"}</span>
              {!pending ? <img src="/figma/login/77060.svg" alt="" aria-hidden="true" /> : null}
            </button>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
          </form>

          <div className="auth-divider"><span>Hoặc tiếp tục với</span></div>
          {googleEnabled ? (
            <a className="auth-google" href={googleHref}>
              <img src="/figma/login/bc562.svg" alt="" aria-hidden="true" />
              <span>Đăng nhập với Google</span>
            </a>
          ) : (
            <button className="auth-google" type="button" onClick={() => setError("Đăng nhập Google chưa được cấu hình cho môi trường local.")}>
              <img src="/figma/login/bc562.svg" alt="" aria-hidden="true" />
              <span>Đăng nhập với Google</span>
            </button>
          )}

          <p className="auth-signup">Chưa có tài khoản? <Link href={registerHref}>Đăng ký ngay</Link></p>
          <footer className="auth-login-footer">
            <Link href="/" aria-label="CareerHub - Trang chủ">
              <img src="/figma/login/7544b.png" alt="CareerHub" width="73" height="20" />
            </Link>
            <span>© 2024 CareerHub</span>
            <a href="mailto:support@careerhub.local">Trợ giúp</a>
            <Link href="/privacy">Bảo mật</Link>
          </footer>
        </div>
      </section>

      <aside className="auth-visual" aria-label="Khám phá cơ hội mới">
        <div className="auth-visual-image" aria-hidden="true" />
        <div className="auth-visual-card">
          <h2>Khám phá cơ hội mới</h2>
          <p>Hàng ngàn công việc chất lượng từ các công ty hàng đầu đang chờ đón bạn. Nâng tầm sự nghiệp ngay hôm nay.</p>
        </div>
      </aside>
    </main>
  );
}

