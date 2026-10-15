"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { requestApi } from "../lib/apiClient";
import { landing, passwordError, person1Error, publicAuth, verifyRegistration } from "../lib/person1Api";

export default function RecruiterRegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [registrationId, setRegistrationId] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verified, setVerified] = useState(false);

  async function saveContact() {
    await requestApi("/auth/me/recruiter-contact", { method: "PUT", privateData: true, body: { fullName: name.trim(), phone: phone.trim() } });
    router.replace(landing("RECRUITER"));
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
        const result = await requestApi<{ registrationId: string }>("/auth/register", { ...publicAuth, method: "POST", body: { email: email.trim(), password, role: "RECRUITER" } });
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
      await requestApi("/auth/otp/resend", { ...publicAuth, method: "POST", body: { email: email.trim(), registrationId } });
      setNotice("Đã yêu cầu gửi lại mã. Tối đa 3 lần mỗi giờ.");
    } catch (reason) { setError(person1Error(reason)); }
    finally { setPending(false); }
  }

  const otpStage = !!registrationId;
  return <main className="auth-portal-page auth-recruiter-register">
    <header className="auth-portal-header">
      <div className="auth-recruiter-header-brand-group"><Link className="auth-portal-brand" href="/" aria-label="CareerHub - Trang chủ"><img src="/figma/register/7f320.png" alt="" width="146" height="40" /></Link><Link className="auth-recruiter-header-title" href="/">CareerHub</Link></div>
      <nav aria-label="Điều hướng"><Link href="/">Trang chủ</Link><Link href="/candidate/jobs">Việc làm</Link><Link href="/companies">Công ty</Link><span>Bạn là nhà tuyển dụng?</span><Link className="auth-header-action" href="/recruiter/login">Đăng nhập</Link></nav>
    </header>
    <section className="auth-recruiter-register-main">
      {verified ? <div className="auth-recruiter-register-card auth-recruiter-success"><h1>Tài khoản Recruiter đã xác minh</h1><p>{notice || "Tài khoản của bạn đã sẵn sàng."}</p>{notice ? <button className="auth-submit" type="button" onClick={() => void retryContact()} disabled={pending}>{pending ? "Đang lưu…" : "Lưu lại thông tin liên hệ"}</button> : null}{error ? <p role="alert" className="auth-error">{error}</p> : null}<Link className="auth-submit auth-submit-link" href="/recruiter/jobs">Tiếp tục đến khu vực tuyển dụng →</Link></div> :
        <form className="auth-recruiter-register-card" noValidate onSubmit={submit}>
          <header className="auth-recruiter-register-heading"><h1>{otpStage ? "Xác minh email Recruiter" : <>Đăng ký tài khoản<br />Recruiter</>}</h1><p>{otpStage ? `Nhập mã OTP 6 số đã gửi đến ${email}.` : "Tạo tài khoản để đăng tin tuyển dụng và tìm kiếm ứng viên phù hợp."}</p></header>
          <div className="auth-recruiter-register-fields">
          {!otpStage ? <>
            <div className="auth-recruiter-register-field"><label htmlFor="recruiter-name">Họ và tên</label><input id="recruiter-name" autoComplete="name" maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder="Nhập họ và tên" disabled={pending} /></div>
            <div className="auth-recruiter-register-field"><label htmlFor="recruiter-email">Email công việc</label><input id="recruiter-email" type="email" autoComplete="email" maxLength={320} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" disabled={pending} /></div>
            <div className="auth-recruiter-register-field"><label htmlFor="recruiter-phone">Số điện thoại</label><input id="recruiter-phone" type="tel" autoComplete="tel" maxLength={32} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+84 90 123 4567" disabled={pending} /></div>
            <div className="auth-recruiter-register-field"><label htmlFor="recruiter-password">Mật khẩu</label><input id="recruiter-password" type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="Tạo mật khẩu" disabled={pending} /></div>
            <div className="auth-recruiter-register-field"><label htmlFor="recruiter-confirm">Xác nhận mật khẩu</label><input id="recruiter-confirm" type="password" autoComplete="new-password" maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Nhập lại mật khẩu" disabled={pending} /></div>
            <label className="auth-recruiter-terms"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>Tôi đồng ý với <Link href="/terms">Điều khoản dịch vụ</Link> và <Link href="/privacy">Chính sách bảo mật</Link> của CareerHub.</span></label>
          </> : <div className="auth-recruiter-register-field"><label htmlFor="recruiter-otp">Mã xác minh OTP</label><input id="recruiter-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="Nhập mã 6 chữ số" disabled={pending} /></div>}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}{notice ? <p className="auth-message" role="status">{notice}</p> : null}
          <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang xử lý…" : otpStage ? "Xác minh tài khoản" : "Đăng ký"}</button>
          {otpStage ? <button className="auth-resend" type="button" onClick={resend} disabled={pending}>Gửi lại mã xác minh</button> : <>
            <div className="auth-recruiter-register-divider"><span>Hoặc</span></div>
            {process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true" ? <a className="auth-google" href="/auth/google?role=RECRUITER"><img src="/figma/login/bc562.svg" alt="" /><span>Đăng ký với Google</span></a> : <button className="auth-google" type="button" onClick={() => setError("Đăng ký Google chưa được cấu hình cho môi trường local.")}><img src="/figma/login/bc562.svg" alt="" /><span>Đăng ký với Google</span></button>}
            <p className="auth-portal-signup">Đã có tài khoản? <Link href="/recruiter/login">Đăng nhập</Link></p>
          </>}
          </div>
        </form>}
    </section>
    <footer className="auth-portal-footer auth-recruiter-register-footer"><div className="auth-recruiter-register-footer-brand"><Link href="/" className="auth-footer-wordmark">CareerHub</Link><span>© 2024 CareerHub. All rights reserved.</span></div><nav className="auth-recruiter-register-footer-links" aria-label="Liên kết chân trang"><Link href="/companies">Company</Link><Link href="/candidate/jobs">Candidates</Link><Link href="/recruiter/login">Recruiters</Link><a href="mailto:support@careerhub.local">Support</a><Link href="/privacy">Legal</Link></nav></footer>
  </main>;
}
