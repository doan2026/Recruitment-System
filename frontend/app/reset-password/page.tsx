"use client";

import { type FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestApi } from "../../lib/apiClientCore";
import { toUserMessage } from "../../lib/apiClient";
import { PublicShell } from "@/components/PublicShell";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"password" | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Extract token from URL fragment e.g., #token=abc
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const tokenParam = params.get("token");
    if (tokenParam) {
      setToken(tokenParam);
    } else {
      setError("Không tìm thấy mã xác thực khôi phục mật khẩu trong liên kết.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    
    if (password.length < 8) {
      setInvalid("password");
      setError("");
      document.getElementById("reset-password")?.focus();
      return;
    }
    
    setInvalid(null);
    setPending(true);
    setError("");
    
    try {
      await requestApi<void>("/auth/reset-password", {
        method: "POST", body: { token, newPassword: password }, privateData: true,
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
      <h1 className="page-title">Đặt lại mật khẩu</h1>
      <p className="muted" style={{ margin: 0 }}>Nhập mật khẩu mới cho tài khoản của bạn.</p>
    </div>
    
    {success ? (
      <div className="card stack" style={{ padding: "32px 24px", alignItems: "center", textAlign: "center" }}>
        <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "var(--primary-soft)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", color: "var(--primary-container)" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        </div>
        <h3 style={{ margin: "0 0 12px" }}>Đặt lại thành công</h3>
        <p className="muted" style={{ margin: 0 }}>
          Mật khẩu của bạn đã được thay đổi. Bạn có thể sử dụng mật khẩu mới để đăng nhập.
        </p>
        <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid var(--line)", width: "100%" }}>
          <button type="button" onClick={() => router.replace("/login")} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>Tiếp tục Đăng nhập</button>
        </div>
      </div>
    ) : (
      <form className="card stack" noValidate onSubmit={submit} style={{ padding: "32px 24px" }}>
        <div className="field">
          <label className="label" htmlFor="reset-password">Mật khẩu mới (tối thiểu 8 ký tự, có chữ và số)</label>
          <div className="row">
            <input className="input" id="reset-password" style={{ flex: 1 }} type={visible ? "text" : "password"} maxLength={128} value={password} disabled={pending || !token} onChange={(e) => setPassword(e.target.value)} aria-invalid={invalid === "password"} />
            <button className="btn btn-secondary" type="button" onClick={() => setVisible(!visible)} disabled={!token}>{visible ? "Ẩn" : "Hiện"}</button>
          </div>
          {invalid === "password" && <span className="form-error">Mật khẩu không hợp lệ.</span>}
        </div>
        
        <button className="btn btn-primary btn-large" style={{ marginTop: "12px", width: "100%", justifyContent: "center" }} type="submit" disabled={pending || !token || !password.trim()} aria-busy={pending}>
          {pending ? "Đang xử lý…" : "Cập nhật mật khẩu"}
        </button>
        {error && <p className="notice notice-danger" style={{ marginTop: "12px" }}>{error}</p>}
      </form>
    )}
  </section></PublicShell>;
}
