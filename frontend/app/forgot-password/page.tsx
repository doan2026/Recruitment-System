"use client";
import Link from "next/link";
import { AuthFrame } from "../../components/AuthFrame";
import { useEffect, useState, type FormEvent } from "react";
import { requestApi } from "../../lib/apiClient";
import { publicAuth, person1Error, loginRoute } from "../../lib/person1Api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [portal, setPortal] = useState<"CANDIDATE" | "RECRUITER" | "ADMIN">("CANDIDATE");
  useEffect(() => {
    const role = new URLSearchParams(window.location.search).get("role");
    if (role === "RECRUITER" || role === "ADMIN") setPortal(role);
  }, []);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Nhập địa chỉ email hợp lệ.");
      return;
    }
    setPending(true); setError("");
    try {
      await requestApi("/api/auth/forgot-password", { ...publicAuth, method: "POST", body: { email: email.trim() } });
      setDone(true);
    } catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }
  return <AuthFrame portal={portal} title="Quên mật khẩu?" description="Nhập email của bạn để nhận liên kết đặt lại mật khẩu.">
    <form className="auth-form" noValidate onSubmit={submit}>
      <div className="auth-field">
        <label htmlFor="forgot-email">Email đăng nhập</label>
        <input id="forgot-email" type="email" autoComplete="email" maxLength={200} required placeholder="Nhập email đăng nhập" disabled={pending || done} value={email} onChange={event => setEmail(event.target.value)} aria-invalid={!!error} aria-describedby={error ? "forgot-error" : undefined} />
      </div>
      {done ? <p className="auth-message" role="status">Nếu email đủ điều kiện, bạn sẽ nhận được liên kết đặt lại mật khẩu.</p> : null}
      {error ? <p id="forgot-error" className="auth-error" role="alert">{error}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending || done} aria-busy={pending}>{pending ? "Đang gửi…" : done ? "Đã gửi yêu cầu" : "Gửi liên kết đặt lại mật khẩu"}</button>
    </form>
    <Link className="auth-back-link" href={loginRoute(portal)}>← Quay lại đăng nhập</Link>
  </AuthFrame>;
}
