"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "../../lib/authSession";
import { toUserMessage } from "../../lib/apiClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"email" | "password" | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const field = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "email" : !password ? "password" : null;
    setInvalid(field); setError("");
    if (field) { document.getElementById(`login-${field}`)?.focus(); return; }
    setPending(true);
    try {
      const account = await signIn(email, password);
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const safeReturn = returnTo && /^\/(?:candidate|recruiter|ai)(?:\/|$)/.test(returnTo) && !returnTo.includes("\\");
      router.replace(safeReturn ? returnTo : account.role === "RECRUITER" ? "/recruiter/jobs" : "/candidate/jobs");
    } catch (reason) { setError(toUserMessage(reason)); setPassword(""); }
    finally { setPending(false); }
  }
  return <section className="page-section">
    <div className="page-header"><div><h1>Đăng nhập CareerHub</h1><p className="muted">Sử dụng tài khoản đã được xác minh trong hệ thống.</p></div></div>
    <form className="card form-stack" noValidate onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="login-email">Email</label>
        <input className="input" id="login-email" type="email" autoComplete="username" maxLength={320} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} aria-invalid={invalid === "email"} aria-describedby={invalid === "email" ? "login-email-error" : undefined} />
        {invalid === "email" ? <span className="form-error" id="login-email-error">Nhập địa chỉ email hợp lệ.</span> : null}
      </div>
      <div className="field">
        <label className="label" htmlFor="login-password">Mật khẩu</label>
        <input className="input" id="login-password" type={visible ? "text" : "password"} autoComplete="current-password" maxLength={128} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} aria-invalid={invalid === "password"} aria-describedby={invalid === "password" ? "login-password-error" : undefined} />
        <button className="btn" type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}</button>
        {invalid === "password" ? <span className="form-error" id="login-password-error">Nhập mật khẩu của bạn.</span> : null}
      </div>
      <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang đăng nhập…" : "Đăng nhập"}</button>
      {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
      <p className="help">Phiên chỉ giữ trong bộ nhớ trình duyệt. Tải lại trang sẽ yêu cầu đăng nhập lại; không lưu mật khẩu hoặc token trên thiết bị.</p>
    </form>
  </section>;
}
