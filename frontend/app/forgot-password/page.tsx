"use client";

import { type FormEvent, useState } from "react";
import { requestApi } from "../../lib/apiClientCore";
import { toUserMessage } from "../../lib/apiClient";
import { PublicShell } from "@/components/PublicShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"email" | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setInvalid("email");
      setError("");
      document.getElementById("forgot-email")?.focus();
      return;
    }
    
    setInvalid(null);
    setPending(true);
    setError("");
    
    try {
      await requestApi<any>("/auth/forgot-password", {
        method: "POST", body: { email: email.trim() }, privateData: true,
        authRecovery: false, attachAccessToken: false, maxRetries: 0,
      });
      setSuccess(true);
    } catch (reason) {
      setError(toUserMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return <PublicShell><section className="page-section" style={{ maxWidth: 460, margin: "60px auto", border: "none", background: "transparent", boxShadow: "none" }}>
    <div className="page-header" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "8px" }}>
      <h1 className="page-title">Quên mật khẩu</h1>
      <p className="muted" style={{ margin: 0 }}>Nhập email để nhận liên kết khôi phục mật khẩu.</p>
    </div>
    
    {success ? (
      <div className="card stack" style={{ padding: "32px 24px", alignItems: "center", textAlign: "center" }}>
        <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "var(--primary-soft)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", color: "var(--primary-container)" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        </div>
        <h3 style={{ margin: "0 0 12px" }}>Đã gửi yêu cầu</h3>
        <p className="muted" style={{ margin: 0 }}>
          Nếu email <strong>{email}</strong> tồn tại trong hệ thống, bạn sẽ nhận được một liên kết đặt lại mật khẩu trong vài phút nữa.
        </p>
        <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid var(--line)", width: "100%" }}>
          <a href="/login" className="btn btn-secondary" style={{ width: "100%", justifyContent: "center" }}>Quay lại trang Đăng nhập</a>
        </div>
      </div>
    ) : (
      <form className="card stack" noValidate onSubmit={submit} style={{ padding: "32px 24px" }}>
        <div className="field">
          <label className="label" htmlFor="forgot-email">Email của bạn</label>
          <input className="input" id="forgot-email" type="email" maxLength={320} value={email} disabled={pending} onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid === "email"} />
          {invalid === "email" && <span className="form-error">Nhập địa chỉ email hợp lệ.</span>}
        </div>
        <button className="btn btn-primary btn-large" style={{ marginTop: "12px", width: "100%", justifyContent: "center" }} type="submit" disabled={pending || !email.trim()} aria-busy={pending}>
          {pending ? "Đang xử lý…" : "Gửi liên kết khôi phục"}
        </button>
        {error && <p className="notice notice-danger" style={{ marginTop: "12px" }}>{error}</p>}
        
        <div style={{ textAlign: "center", marginTop: "24px" }}>
          <a href="/login" className="text-link" style={{ color: "var(--muted)" }}>&larr; Quay lại Đăng nhập</a>
        </div>
      </form>
    )}
  </section></PublicShell>;
}
