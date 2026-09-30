"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestApi } from "../../lib/apiClient";
import { publicAuth, person1Error } from "../../lib/person1Api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      await requestApi("/auth/forgot-password", { ...publicAuth, method: "POST", body: { email: email.trim() } });
      setDone(true);
    } catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }
  return <main className="auth-page auth-forgot" data-node-id="22:206">
    <section className="auth-forgot-panel">
      <Link className="auth-brand auth-forgot-brand" href="/" aria-label="CareerHub"><img src="/figma/forgot/6aca2.png" alt="CareerHub" width="117" height="32" /></Link>
      <div className="auth-forgot-content">
        <header className="auth-heading"><h1>Quên mật khẩu?</h1><p>Nhập email của bạn để nhận mã xác thực và khôi phục tài khoản.</p></header>
        <form className="auth-form" noValidate onSubmit={submit}>
          <div className="auth-field"><label htmlFor="forgot-email">Email đăng nhập</label><div className="auth-input-wrap"><img className="auth-field-icon" src="/figma/forgot/61df5.svg" alt="" aria-hidden="true" /><input id="forgot-email" type="email" autoComplete="email" maxLength={200} required placeholder="ví dụ: ten@email.com" disabled={pending || done} value={email} onChange={(e) => setEmail(e.target.value)} /></div></div>
          <button className="auth-submit" type="submit" disabled={pending || done} aria-busy={pending}><span>{pending ? "Đang gửi…" : done ? "Đã gửi yêu cầu" : "Gửi mã xác thực"}</span><img src="/figma/forgot/eb84b.svg" alt="" aria-hidden="true" /></button>
          {done ? <p className="auth-message" role="status">Nếu email đủ điều kiện, bạn sẽ nhận được liên kết đặt lại mật khẩu.</p> : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
        </form>
        <Link className="auth-back-link" href="/login">← Quay lại đăng nhập</Link>
      </div>
    </section>
    <aside className="auth-forgot-visual" aria-hidden="true"><div className="auth-forgot-art" /></aside>
  </main>;
}