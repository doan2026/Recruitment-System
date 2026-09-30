"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestApi } from "../../lib/apiClient";
import { landing, passwordError, person1Error, publicAuth, verifyRegistration } from "../../lib/person1Api";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<"CANDIDATE" | "RECRUITER">("CANDIDATE");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [flow, setFlow] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verified, setVerified] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("role") === "RECRUITER") setRole("RECRUITER");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || verified) return;
    setError("");
    setNotice("");
    if (!flow) {
      if (fullName.trim().length < 2 || fullName.trim().length > 160) {
        setError("Nhập họ tên từ 2 đến 160 ký tự."); return;
      }
      const passwordIssue = passwordError(password);
      if (passwordIssue) { setError(passwordIssue); return; }
      if (password !== confirm) { setError("Hai mật khẩu chưa trùng nhau."); return; }
      if (!termsAccepted) { setError("Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật."); return; }
    } else if (!/^[0-9]{6}$/.test(otp)) {
      setError("Nhập mã xác minh gồm 6 chữ số."); return;
    }

    setPending(true);
    try {
      if (flow) {
        const account = await verifyRegistration(email.trim(), flow, otp);
        setVerified(true);
        if (account.role === "CANDIDATE" && fullName.trim()) {
          try {
            await requestApi(`/profile/${account.id}`, { method: "PUT", privateData: true, body: { fullName: fullName.trim() } });
          } catch {
            setNotice("Email đã xác minh. Hồ sơ chưa lưu được tên; bạn có thể bổ sung tại trang Hồ sơ cá nhân.");
            setPending(false);
            return;
          }
        }
        router.replace(landing(account.role));
      } else {
        const result = await requestApi<{ registrationId: string }>("/auth/register", {
          ...publicAuth,
          method: "POST",
          body: { email: email.trim(), password, role },
        });
        setFlow(result.data.registrationId);
        setPassword("");
        setConfirm("");
        setNotice("Mã xác minh có hiệu lực 5 phút. Kiểm tra hộp thư của bạn.");
      }
    } catch (reason) {
      setError(person1Error(reason));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (pending || !flow) return;
    setPending(true); setError("");
    try {
      await requestApi("/auth/otp/resend", { ...publicAuth, method: "POST", body: { email: email.trim(), registrationId: flow } });
      setNotice("Đã yêu cầu gửi lại mã. Bạn có thể gửi lại tối đa 3 lần mỗi giờ.");
    } catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }

  if (verified) {
    return <main className="auth-page auth-otp" data-node-id="22:954">
      <section className="auth-otp-panel">
        <Link className="auth-brand" href="/" aria-label="CareerHub"><img src="/figma/otp/6aca2.png" alt="CareerHub" width="117" height="32" /></Link>
        <h1>Tài khoản đã xác minh</h1>
        <p className="auth-copy">Tài khoản của bạn đã sẵn sàng. Tiếp tục đến hồ sơ để hoàn thiện thông tin.</p>
        {notice ? <p className="auth-message" role="status">{notice}</p> : null}
        <Link className="auth-submit auth-submit-link" href={role === "RECRUITER" ? "/recruiter/jobs" : "/candidate/profile"}>Tiếp tục đến CareerHub <span aria-hidden="true">→</span></Link>
      </section>
      <aside className="auth-otp-visual" aria-label="Xác thực tài khoản"><div className="auth-otp-image" /></aside>
    </main>;
  }

  return <main className={`auth-page ${flow ? "auth-otp" : "auth-register"}`} data-node-id={flow ? "22:954" : "22:86"}>
    <section className={flow ? "auth-otp-panel" : "auth-register-panel"}>
      <Link className="auth-brand" href="/" aria-label="CareerHub"><img src={flow ? "/figma/otp/6aca2.png" : "/figma/register/7f320.png"} alt="CareerHub" width="146" height="40" /></Link>
      <header className="auth-heading">
        <h1>{flow ? "Xác thực tài khoản" : role === "RECRUITER" ? "Tạo tài khoản nhà tuyển dụng" : "Tạo tài khoản mới"}</h1>
        <p>{flow ? `Nhập mã OTP 6 số đã được gửi đến ${email}.` : "Khám phá cơ hội nghề nghiệp tuyệt vời dành cho bạn."}</p>
      </header>
      <form className="auth-form auth-register-form" noValidate onSubmit={submit}>
        {!flow ? <>
          <div className="auth-field"><label htmlFor="register-name">Họ tên</label><div className="auth-input-wrap"><img className="auth-field-icon" src="/figma/register/9bae1.svg" alt="" aria-hidden="true" /><input id="register-name" autoComplete="name" maxLength={160} placeholder="Nhập họ và tên của bạn" value={fullName} disabled={pending} onChange={(e) => setFullName(e.target.value)} /></div></div>
          <div className="auth-field"><label htmlFor="register-email">Email</label><div className="auth-input-wrap"><img className="auth-field-icon" src="/figma/register/0094c.svg" alt="" aria-hidden="true" /><input id="register-email" type="email" autoComplete="email" maxLength={200} placeholder="VD: nguyenvan@example.com" value={email} disabled={pending} onChange={(e) => setEmail(e.target.value)} /></div></div>
          <div className="auth-field"><label htmlFor="register-password">Mật khẩu</label><div className="auth-input-wrap"><img className="auth-field-icon auth-lock-icon" src="/figma/register/d3bee.svg" alt="" aria-hidden="true" /><input id="register-password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} placeholder="Tạo mật khẩu mạnh" value={password} disabled={pending} onChange={(e) => setPassword(e.target.value)} /><button className="auth-visibility" type="button" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}><img src="/figma/register/11563.svg" alt="" aria-hidden="true" /></button></div></div>
          <div className="auth-field"><label htmlFor="register-confirm">Xác nhận mật khẩu</label><div className="auth-input-wrap"><img className="auth-field-icon auth-lock-icon" src="/figma/register/d3bee.svg" alt="" aria-hidden="true" /><input id="register-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} placeholder="Nhập lại mật khẩu" value={confirm} disabled={pending} onChange={(e) => setConfirm(e.target.value)} /><button className="auth-visibility" type="button" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}><img src="/figma/register/11563.svg" alt="" aria-hidden="true" /></button></div></div>
          <label className="auth-terms"><input type="checkbox" checked={termsAccepted} disabled={pending} onChange={(e) => setTermsAccepted(e.target.checked)} /><span>Tôi đồng ý với <a href="#terms">Điều khoản sử dụng</a> và <a href="#privacy">Chính sách bảo mật</a> của CareerHub.</span></label>
        </> : <>
          <label className="auth-otp-field" htmlFor="register-otp"><span className="sr-only">Mã xác minh gồm 6 chữ số</span><input id="register-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus value={otp} disabled={pending} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="• • • • • •" /></label>
          <div className="auth-otp-actions"><span>Mã có hiệu lực trong 05:00</span><button type="button" disabled={pending} onClick={() => void resend()}>Chưa nhận được mã? Gửi lại</button></div>
        </>}
        <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}><span>{pending ? "Đang xử lý…" : flow ? "Xác nhận" : "Đăng ký"}</span><img src="/figma/register/77060.svg" alt="" aria-hidden="true" /></button>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {notice ? <p className="auth-message" role="status">{notice}</p> : null}
        {flow ? <button className="auth-back-button" type="button" disabled={pending} onClick={() => { setFlow(""); setOtp(""); setNotice(""); }}>← Quay lại</button> : null}
      </form>
      {!flow ? <>
        <div className="auth-divider"><span>hoặc</span></div>
        <button className="auth-google" type="button" onClick={() => setError("Đăng ký Google chưa được cấu hình cho môi trường local.")}><img src="/figma/register/bc562.svg" alt="" aria-hidden="true" /><span>Đăng ký với Google</span></button>
        <p className="auth-signup">Đã có tài khoản? <Link href="/login">Đăng nhập</Link></p>
      </> : null}
      {!flow ? <p className="auth-role-switch">Bạn là nhà tuyển dụng? <Link href="/register?role=RECRUITER">Tạo tài khoản tuyển dụng</Link></p> : null}
    </section>
    {flow ? <aside className="auth-otp-visual" aria-label="Xác thực tài khoản"><div className="auth-otp-image" /><div className="auth-security-chip"><strong>Bảo mật</strong><span>An toàn 100%</span></div></aside> : <aside className="auth-register-visual" aria-label="Cơ hội nghề nghiệp tại CareerHub">
      <div className="auth-featured-image"><span>Featured Opportunity</span><div><strong>Senior Product Designer</strong><small>TechNova Inc. · San Francisco, CA</small></div></div>
      <div className="auth-register-cards"><article className="auth-stat-card"><span className="auth-stat-icon">↗</span><strong>15,000+</strong><p>Công việc mới mỗi ngày</p></article><article className="auth-quote-card"><p>“CareerHub giúp tôi tìm được công việc mơ ước chỉ trong 2 tuần!”</p><div><img src="/figma/register/a8c33.png" alt="" /><span><strong>Minh Anh</strong><small>UX Researcher</small></span></div></article></div>
    </aside>}
  </main>;
}