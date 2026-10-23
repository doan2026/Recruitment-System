"use client";

import Link from "next/link";
import { AuthFrame, GoogleAuthButton, PasswordToggle } from "../../components/AuthFrame";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestApi } from "../../lib/apiClient";
import { loginDestination, passwordError, person1Error, publicAuth, verifyRegistration } from "../../lib/person1Api";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const role = "CANDIDATE" as const;
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [flow, setFlow] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verified, setVerified] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [destination, setDestination] = useState("/candidate/profile");
  const [loginHref, setLoginHref] = useState("/login");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const returnTo = query.get("returnTo");
    if (query.get("role") === "RECRUITER") {
      router.replace("/recruiter/register" + (returnTo ? `?returnTo=${encodeURIComponent(loginDestination("RECRUITER", returnTo))}` : ""));
      return;
    }
    setDestination(loginDestination("CANDIDATE", returnTo));
    if (returnTo) setLoginHref(`/login?returnTo=${encodeURIComponent(loginDestination("CANDIDATE", returnTo))}`);
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError("Nhập địa chỉ email hợp lệ.");
        document.getElementById("register-email")?.focus();
        return;
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
            await requestApi(`/api/profile/${account.id}`, { method: "PUT", privateData: true, body: { fullName: fullName.trim() } });
          } catch {
            setNotice("Email đã xác minh. Hồ sơ chưa lưu được tên; bạn có thể bổ sung tại trang Hồ sơ cá nhân.");
            setPending(false);
            return;
          }
        }
        router.replace(loginDestination(account.role, destination));
      } else {
        const result = await requestApi<{ registrationId: string }>("/api/auth/register", {
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
      await requestApi("/api/auth/otp/resend", { ...publicAuth, method: "POST", body: { email: email.trim(), registrationId: flow } });
      setNotice("Đã yêu cầu gửi lại mã. Bạn có thể gửi lại tối đa 3 lần mỗi giờ.");
    } catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }

  if (verified) return <AuthFrame portal="CANDIDATE" title="Tài khoản đã xác minh" description="Tài khoản của bạn đã sẵn sàng. Tiếp tục đến hồ sơ để hoàn thiện thông tin.">
    {notice ? <p className="auth-message" role="status">{notice}</p> : null}
    <Link className="auth-submit" href={destination}>Tiếp tục đến CareerHub →</Link>
  </AuthFrame>;

  return <AuthFrame portal="CANDIDATE" title={flow ? "Xác thực tài khoản" : "Tạo tài khoản mới"} description={flow ? `Nhập mã OTP 6 số đã được gửi đến ${email}.` : "Tạo tài khoản ứng viên để bắt đầu hành trình tìm việc của bạn."}>
    <form className="auth-form" noValidate onSubmit={submit}>
      {!flow ? <>
        <div className="auth-field"><label htmlFor="register-name">Họ tên</label><input id="register-name" autoComplete="name" maxLength={160} placeholder="Nhập họ và tên" value={fullName} disabled={pending} onChange={event => setFullName(event.target.value)} /></div>
        <div className="auth-field"><label htmlFor="register-email">Email</label><input id="register-email" type="email" autoComplete="email" maxLength={200} placeholder="Nhập địa chỉ email" value={email} disabled={pending} onChange={event => setEmail(event.target.value)} /></div>
        <div className="auth-field"><label htmlFor="register-password">Mật khẩu</label><div className="auth-input-wrap"><input id="register-password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} placeholder="Tạo mật khẩu" value={password} disabled={pending} onChange={event => setPassword(event.target.value)} aria-describedby="register-password-help" /><PasswordToggle visible={showPassword} disabled={pending} onToggle={() => setShowPassword(value => !value)} /></div></div>
        <div className="auth-field"><label htmlFor="register-confirm">Xác nhận mật khẩu</label><div className="auth-input-wrap"><input id="register-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} placeholder="Nhập lại mật khẩu" value={confirm} disabled={pending} onChange={event => setConfirm(event.target.value)} /><PasswordToggle visible={showPassword} disabled={pending} onToggle={() => setShowPassword(value => !value)} /></div></div>
        <p id="register-password-help" className="auth-help">Ít nhất 8 ký tự, có chữ và số, tối đa 72 byte.</p>
        <label className="auth-terms"><input type="checkbox" checked={termsAccepted} disabled={pending} onChange={event => setTermsAccepted(event.target.checked)} /><span>Tôi đồng ý với <Link href="/terms">Điều khoản sử dụng</Link> và <Link href="/privacy">Chính sách bảo mật</Link> của CareerHub.</span></label>
      </> : <>
        <div className="auth-field"><label htmlFor="register-otp">Mã xác minh gồm 6 chữ số</label><input className="auth-otp-input" id="register-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus value={otp} disabled={pending} onChange={event => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></div>
        <p className="auth-help">Mã xác minh có hiệu lực 5 phút kể từ khi gửi.</p>
      </>}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {notice ? <p className="auth-message" role="status">{notice}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang xử lý…" : flow ? "Xác nhận" : "Đăng ký"}</button>
      {flow ? <>
        <button className="auth-resend" type="button" disabled={pending} onClick={() => void resend()}>Chưa nhận được mã? Gửi lại</button>
        <button className="auth-resend" type="button" disabled={pending} onClick={() => { setFlow(""); setOtp(""); setNotice(""); }}>← Quay lại</button>
      </> : null}
    </form>
    {!flow ? <>
      <div className="auth-divider"><span>Hoặc</span></div>
      <GoogleAuthButton href="/auth/google?role=CANDIDATE" label="Đăng ký với Google" disabled={pending} onUnavailable={() => setError("Đăng ký Google chưa được cấu hình cho môi trường này.")} />
      <p className="auth-signup">Đã có tài khoản? <Link href={loginHref}>Đăng nhập</Link></p>
    </> : null}
  </AuthFrame>;
}
