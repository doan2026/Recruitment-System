"use client";
import Link from "next/link";
import { AuthFrame } from "../../components/AuthFrame";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestApi } from "../../lib/apiClient";
import { publicAuth, passwordError, person1Error, person1FormError } from "../../lib/person1Api";
export default function ResetPasswordPage() {
  const token = useRef("");
  const read = useRef(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    token.current =
      new URLSearchParams(location.hash.slice(1)).get("token") ??
      new URLSearchParams(location.search).get("token") ??
      "";
    history.replaceState(null, "", location.pathname);
    if (!token.current)
      setError("Liên kết không hợp lệ. Hãy yêu cầu đặt lại mật khẩu.");
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !token.current) return;
    const formIssue = person1FormError(e.currentTarget);
    if (formIssue) { setError(formIssue); return; }
    const problem = passwordError(password);
    if (problem || password !== confirm) {
      setError(problem ?? "Hai mật khẩu chưa trùng nhau.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await requestApi("/api/auth/reset-password", {
        ...publicAuth,
        method: "POST",
        body: { token: token.current, newPassword: password },
      });
      token.current = "";
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  return <AuthFrame title="Đặt lại mật khẩu" description="Chọn mật khẩu mới để tiếp tục sử dụng tài khoản CareerHub.">
    <form className="auth-form" noValidate onSubmit={submit}>
      {done ? <p className="auth-message" role="status">Mật khẩu đã được cập nhật. Hãy đăng nhập lại.</p> : <>
        <div className="auth-field"><label htmlFor="reset-password">Mật khẩu mới</label><input id="reset-password" type="password" autoComplete="new-password" required maxLength={128} disabled={pending} value={password} onChange={event => setPassword(event.target.value)} aria-describedby="reset-password-help" /></div>
        <div className="auth-field"><label htmlFor="reset-confirm">Nhập lại mật khẩu</label><input id="reset-confirm" type="password" autoComplete="new-password" required maxLength={128} disabled={pending} value={confirm} onChange={event => setConfirm(event.target.value)} /></div>
        <p id="reset-password-help" className="auth-help">Ít nhất 8 ký tự, có chữ và số, tối đa 72 byte.</p>
        <button className="auth-submit" type="submit" disabled={pending || !token.current} aria-busy={pending}>{pending ? "Đang lưu…" : "Lưu mật khẩu"}</button>
      </>}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </form>
    <p className="auth-signup"><Link href="/login">Đăng nhập</Link></p>
    <Link className="auth-back-link" href="/forgot-password">Yêu cầu liên kết mới</Link>
  </AuthFrame>;
}
