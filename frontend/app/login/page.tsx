"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "../../lib/authSession";
import { toUserMessage } from "../../lib/apiClient";
import { PublicShell } from "@/components/PublicShell";

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
  return <PublicShell><section className="page-section" style={{ maxWidth: 460, margin: "60px auto", border: "none", background: "transparent", boxShadow: "none" }}>
    <div className="page-header" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "8px" }}>
      <h1 className="page-title">Đăng nhập CareerHub</h1>
      <p className="muted" style={{ margin: 0 }}>Chào mừng trở lại! Vui lòng đăng nhập.</p>
    </div>
    <form className="card stack" noValidate onSubmit={submit} style={{ padding: "32px 24px" }}>
      <div className="field">
        <label className="label" htmlFor="login-email">Email</label>
        <input className="input" id="login-email" type="email" autoComplete="username" maxLength={320} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} aria-invalid={invalid === "email"} aria-describedby={invalid === "email" ? "login-email-error" : undefined} />
        {invalid === "email" ? <span className="form-error" id="login-email-error">Nhập địa chỉ email hợp lệ.</span> : null}
      </div>
      <div className="field">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label className="label" htmlFor="login-password">Mật khẩu</label>
          <a href="/forgot-password" style={{ fontSize: "0.85rem", color: "var(--primary)" }}>Quên mật khẩu?</a>
        </div>
        <div className="row">
          <input className="input" id="login-password" style={{ flex: 1 }} type={visible ? "text" : "password"} autoComplete="current-password" maxLength={128} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} aria-invalid={invalid === "password"} aria-describedby={invalid === "password" ? "login-password-error" : undefined} />
          <button className="btn btn-secondary" type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Ẩn" : "Hiện"}</button>
        </div>
        {invalid === "password" ? <span className="form-error" id="login-password-error">Nhập mật khẩu của bạn.</span> : null}
      </div>
      <button className="btn btn-primary btn-large" style={{ marginTop: "12px" }} type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang xử lý…" : "Đăng nhập"}</button>
      {error ? <p className="notice notice-danger" role="alert" style={{ marginTop: "12px" }}>{error}</p> : null}
      
      <div style={{ textAlign: "center", marginTop: "20px", paddingTop: "20px", borderTop: "1px solid var(--line)" }}>
        <p className="help" style={{ marginBottom: "8px" }}>Chưa có tài khoản?</p>
        <a href="/register" className="text-link">Đăng ký ngay <span>&rarr;</span></a>
      </div>
    </form>
    <p className="help" style={{ textAlign: "center", marginTop: "24px", fontSize: "0.8rem" }}>
      Phiên đăng nhập được lưu trữ an toàn.<br />
      Không lưu mật khẩu trên thiết bị công cộng.
    </p>
  </section></PublicShell>;
}
