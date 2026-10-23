"use client";
import Link from "next/link";
import { AuthFrame, GoogleAuthButton, PasswordToggle } from "./AuthFrame";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { requestApi } from "../lib/apiClient";
import { loginDestination, passwordError, person1Error, publicAuth, verifyRegistration } from "../lib/person1Api";

export default function RecruiterRegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [registrationId, setRegistrationId] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verified, setVerified] = useState(false);
  const [destination, setDestination] = useState("/recruiter/jobs");
  const [loginHref, setLoginHref] = useState("/recruiter/login");
  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    setDestination(loginDestination("RECRUITER", returnTo));
    if (returnTo) setLoginHref(`/recruiter/login?returnTo=${encodeURIComponent(loginDestination("RECRUITER", returnTo))}`);
  }, []);

  async function saveContact() {
    await requestApi("/api/auth/me/recruiter-contact", { method: "PUT", privateData: true, body: { fullName: name.trim(), phone: phone.trim() } });
    router.replace(destination);
  }

  async function retryContact() {
    if (pending) return;
    setPending(true); setError("");
    try { await saveContact(); }
    catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || verified) return;
    setError(""); setNotice("");
    if (!registrationId) {
      if (name.trim().length < 2 || name.trim().length > 160) return setError("Họ tên cần từ 2 đến 160 ký tự.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Nhập email công việc hợp lệ.");
      if (!/^[0-9+(). -]{6,32}$/.test(phone.trim()) || !/^(?:\D*\d){6,15}\D*$/.test(phone.trim())) return setError("Nhập số điện thoại hợp lệ, có từ 6 đến 15 chữ số.");
      const issue = passwordError(password);
      if (issue) return setError(issue);
      if (password !== confirm) return setError("Hai mật khẩu chưa trùng nhau.");
      if (!accepted) return setError("Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật.");
    } else if (!/^[0-9]{6}$/.test(otp)) return setError("Nhập mã xác minh gồm 6 chữ số.");

    setPending(true);
    try {
      if (registrationId) {
        const account = await verifyRegistration(email.trim(), registrationId, otp);
        setVerified(true);
        if (account.role !== "RECRUITER") { setNotice("Tài khoản được xác minh với vai trò khác. Vui lòng đăng nhập qua đúng cổng."); return; }
        try {
          await saveContact();
        } catch {
          setNotice("Tài khoản đã xác minh, nhưng chưa lưu được tên và số điện thoại. Hãy lưu lại thông tin liên hệ để hoàn tất.");
        }
      } else {
        const result = await requestApi<{ registrationId: string }>("/api/auth/register", { ...publicAuth, method: "POST", body: { email: email.trim(), password, role: "RECRUITER" } });
        setRegistrationId(result.data.registrationId); setPassword(""); setConfirm("");
        setNotice("Mã xác minh có hiệu lực 5 phút. Kiểm tra hộp thư email công việc.");
      }
    } catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }

  async function resend() {
    if (pending || !registrationId) return;
    setPending(true); setError(""); setNotice("");
    try {
      await requestApi("/api/auth/otp/resend", { ...publicAuth, method: "POST", body: { email: email.trim(), registrationId } });
      setNotice("Đã yêu cầu gửi lại mã. Tối đa 3 lần mỗi giờ.");
    } catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }

  const otpStage = !!registrationId;
  if (verified) return <AuthFrame portal="RECRUITER" title="Tài khoản Recruiter đã xác minh" description="Tài khoản của bạn đã sẵn sàng để quản lý hoạt động tuyển dụng.">
    {notice ? <p className="auth-message" role="status">{notice}</p> : null}
    {notice ? <button className="auth-submit" type="button" onClick={() => void retryContact()} disabled={pending}>{pending ? "Đang lưu…" : "Lưu lại thông tin liên hệ"}</button> : null}
    {error ? <p role="alert" className="auth-error">{error}</p> : null}
    <Link className="auth-submit" href={destination}>Tiếp tục đến khu vực tuyển dụng →</Link>
  </AuthFrame>;

  return <AuthFrame portal="RECRUITER" title={otpStage ? "Xác minh email Recruiter" : "Đăng ký tài khoản Recruiter"} description={otpStage ? `Nhập mã OTP 6 số đã gửi đến ${email}.` : "Tạo tài khoản để đăng tin tuyển dụng và tìm kiếm ứng viên phù hợp."}>
    <form className="auth-form" noValidate onSubmit={submit}>
      {!otpStage ? <>
        <div className="auth-field"><label htmlFor="recruiter-name">Họ và tên</label><input id="recruiter-name" autoComplete="name" maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Nhập họ và tên" disabled={pending} /></div>
        <div className="auth-field"><label htmlFor="recruiter-email">Email công việc</label><input id="recruiter-email" type="email" autoComplete="email" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" disabled={pending} /></div>
        <div className="auth-field"><label htmlFor="recruiter-phone">Số điện thoại</label><input id="recruiter-phone" type="tel" autoComplete="tel" maxLength={32} value={phone} onChange={event => setPhone(event.target.value)} placeholder="Nhập số điện thoại liên hệ" disabled={pending} /></div>
        <div className="auth-field"><label htmlFor="recruiter-password">Mật khẩu</label><div className="auth-input-wrap"><input id="recruiter-password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="Tạo mật khẩu" disabled={pending} aria-describedby="recruiter-password-help" /><PasswordToggle visible={showPassword} disabled={pending} onToggle={() => setShowPassword(value => !value)} /></div></div>
        <div className="auth-field"><label htmlFor="recruiter-confirm">Xác nhận mật khẩu</label><div className="auth-input-wrap"><input id="recruiter-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Nhập lại mật khẩu" disabled={pending} /><PasswordToggle visible={showPassword} disabled={pending} onToggle={() => setShowPassword(value => !value)} /></div></div>
        <p id="recruiter-password-help" className="auth-help">Ít nhất 8 ký tự, có chữ và số, tối đa 72 byte.</p>
        <label className="auth-terms"><input type="checkbox" checked={accepted} disabled={pending} onChange={event => setAccepted(event.target.checked)} /><span>Tôi đồng ý với <Link href="/terms">Điều khoản dịch vụ</Link> và <Link href="/privacy">Chính sách bảo mật</Link> của CareerHub.</span></label>
      </> : <>
        <div className="auth-field"><label htmlFor="recruiter-otp">Mã xác minh OTP</label><input className="auth-otp-input" id="recruiter-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="000000" disabled={pending} /></div>
        <p className="auth-help">Mã xác minh có hiệu lực 5 phút kể từ khi gửi.</p>
      </>}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {notice ? <p className="auth-message" role="status">{notice}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang xử lý…" : otpStage ? "Xác minh tài khoản" : "Đăng ký"}</button>
      {otpStage ? <button className="auth-resend" type="button" onClick={() => void resend()} disabled={pending}>Gửi lại mã xác minh</button> : null}
    </form>
    {!otpStage ? <>
      <div className="auth-divider"><span>Hoặc</span></div>
      <GoogleAuthButton href="/auth/google?role=RECRUITER" label="Đăng ký với Google" disabled={pending} onUnavailable={() => setError("Đăng ký Google chưa được cấu hình cho môi trường này.")} />
      <p className="auth-signup">Đã có tài khoản? <Link href={loginHref}>Đăng nhập</Link></p>
    </> : null}
  </AuthFrame>;
}
