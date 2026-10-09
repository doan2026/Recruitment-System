"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { requestApi } from "../../lib/apiClientCore";
import { toUserMessage } from "../../lib/apiClient";
import { PublicShell } from "@/components/PublicShell";

export default function RegisterPage() {
  const router = useRouter();
  
  // Step 1: Register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"CANDIDATE" | "RECRUITER">("CANDIDATE");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"email" | "password" | "otp" | null>(null);

  // Step 2: OTP
  const [step, setStep] = useState<"REGISTER" | "OTP">("REGISTER");
  const [registrationId, setRegistrationId] = useState("");
  const [otp, setOtp] = useState("");

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const field = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "email" : password.length < 8 ? "password" : null;
    setInvalid(field); 
    setError("");
    if (field) { document.getElementById(`reg-${field}`)?.focus(); return; }
    
    setPending(true);
    try {
      const response = await requestApi<any>("/auth/register", {
        method: "POST", body: { email: email.trim(), password, role }, privateData: true,
        authRecovery: false, attachAccessToken: false, maxRetries: 0,
      });
      if (response.data?.registrationId) {
        setRegistrationId(response.data.registrationId);
        setStep("OTP");
      }
    } catch (reason) { 
      setError(toUserMessage(reason)); 
    } finally { 
      setPending(false); 
    }
  }

  async function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (otp.length !== 6) { setInvalid("otp"); return; }
    setPending(true);
    setError("");
    try {
      // Verify OTP endpoint
      await requestApi<any>("/auth/otp/verify", {
        method: "POST", body: { email: email.trim(), registrationId, otp }, privateData: true,
        authRecovery: false, attachAccessToken: false, maxRetries: 0,
      });
      
      // Redirecting to login is the safest way to ensure clean session state.
      router.replace(`/login?registered=1`);
    } catch (reason) { 
      setError(toUserMessage(reason)); 
    } finally { 
      setPending(false); 
    }
  }

  return <PublicShell><section className="page-section" style={{ maxWidth: 460, margin: "60px auto", border: "none", background: "transparent", boxShadow: "none" }}>
    <div className="page-header" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "8px" }}>
      <h1 className="page-title">Đăng ký CareerHub</h1>
      <p className="muted" style={{ margin: 0 }}>
        {step === "REGISTER" ? "Tạo tài khoản mới để bắt đầu hành trình của bạn." : "Vui lòng nhập mã OTP đã gửi đến email của bạn."}
      </p>
    </div>
    
    {step === "REGISTER" ? (
      <form className="card stack" noValidate onSubmit={submitRegister} style={{ padding: "32px 24px" }}>
        <div className="field">
          <label className="label">Bạn là:</label>
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button type="button" className={`btn ${role === "CANDIDATE" ? "btn-primary" : "btn-secondary"}`} style={{ flex: 1, justifyContent: "center" }} onClick={() => setRole("CANDIDATE")}>Ứng viên</button>
            <button type="button" className={`btn ${role === "RECRUITER" ? "btn-primary" : "btn-secondary"}`} style={{ flex: 1, justifyContent: "center" }} onClick={() => setRole("RECRUITER")}>Nhà tuyển dụng</button>
          </div>
        </div>
        <div className="field" style={{ marginTop: "12px" }}>
          <label className="label" htmlFor="reg-email">Email</label>
          <input className="input" id="reg-email" type="email" maxLength={320} value={email} disabled={pending} onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid === "email"} />
          {invalid === "email" && <span className="form-error">Nhập địa chỉ email hợp lệ.</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="reg-password">Mật khẩu</label>
          <div className="row">
            <input className="input" id="reg-password" style={{ flex: 1 }} type={visible ? "text" : "password"} maxLength={128} value={password} disabled={pending} onChange={(e) => setPassword(e.target.value)} aria-invalid={invalid === "password"} />
            <button className="btn btn-secondary" type="button" onClick={() => setVisible(!visible)}>{visible ? "Ẩn" : "Hiện"}</button>
          </div>
          {invalid === "password" && <span className="form-error">Mật khẩu cần ít nhất 8 ký tự.</span>}
        </div>
        <button className="btn btn-primary btn-large" style={{ marginTop: "12px", width: "100%", justifyContent: "center" }} type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang xử lý…" : "Tạo tài khoản"}</button>
        {error && <p className="notice notice-danger" style={{ marginTop: "12px" }}>{error}</p>}
        <div style={{ textAlign: "center", marginTop: "20px", paddingTop: "20px", borderTop: "1px solid var(--line)" }}>
          <p className="help" style={{ marginBottom: "8px" }}>Đã có tài khoản?</p>
          <a href="/login" className="text-link">Đăng nhập ngay <span>&rarr;</span></a>
        </div>
      </form>
    ) : (
      <form className="card stack" noValidate onSubmit={submitOtp} style={{ padding: "32px 24px", alignItems: "center" }}>
        <div className="field" style={{ width: "100%" }}>
          <label className="label" htmlFor="reg-otp">Mã xác thực (6 số)</label>
          <input className="input" id="reg-otp" type="text" maxLength={6} style={{ textAlign: "center", fontSize: "1.5rem", letterSpacing: "4px" }} value={otp} disabled={pending} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} aria-invalid={invalid === "otp"} />
        </div>
        <button className="btn btn-primary btn-large" style={{ marginTop: "12px", width: "100%", justifyContent: "center" }} type="submit" disabled={pending || otp.length !== 6}>{pending ? "Đang xác thực…" : "Xác thực OTP"}</button>
        {error && <p className="notice notice-danger" style={{ marginTop: "12px", width: "100%" }}>{error}</p>}
      </form>
    )}
  </section></PublicShell>;
}
