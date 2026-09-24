"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestApi } from "../../lib/apiClient";
import {
  landing,
  passwordError,
  person1Error,
  publicAuth,
  verifyRegistration,
} from "../../lib/person1Api";
export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"CANDIDATE" | "RECRUITER">("CANDIDATE");
  const [flow, setFlow] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setNotice("");
    if (!flow && passwordError(password)) {
      setError(passwordError(password)!);
      return;
    }
    setPending(true);
    try {
      if (flow) {
        const account = await verifyRegistration(email.trim(), flow, otp);
        router.replace(landing(account.role));
      } else {
        const result = await requestApi<{ registrationId: string }>(
          "/auth/register",
          {
            ...publicAuth,
            method: "POST",
            body: { email: email.trim(), password, role },
          },
        );
        setFlow(result.data.registrationId);
        setPassword("");
        setNotice("Mã xác minh có hiệu lực 5 phút. Kiểm tra hộp thư của bạn.");
      }
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  async function resend() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await requestApi("/auth/otp/resend", {
        ...publicAuth,
        method: "POST",
        body: { email: email.trim(), registrationId: flow },
      });
      setNotice(
        "Đã yêu cầu gửi lại mã. Bạn có thể gửi lại tối đa 3 lần mỗi giờ.",
      );
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="page-section">
      <h1>{flow ? "Xác minh email" : "Tạo tài khoản"}</h1>
      <form className="card form-stack" onSubmit={submit}>
        <fieldset disabled={pending} className="form-stack person1-fieldset">
          <label className="field">
            Email
            <input
              className="input"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              value={email}
              disabled={!!flow}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {flow ? (
            <label className="field">
              Mã xác minh
              <input
                className="input"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="field">
                Vai trò
                <select
                  className="select"
                  value={role}
                  onChange={(e) => setRole(e.target.value as typeof role)}
                >
                  <option value="CANDIDATE">Ứng viên</option>
                  <option value="RECRUITER">Nhà tuyển dụng</option>
                </select>
              </label>
              <label className="field">
                Mật khẩu
                <input
                  className="input"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  maxLength={128}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <p className="help">
                Ít nhất 8 ký tự, có chữ và số. Vai trò được giữ cố định sau đăng
                ký.
              </p>
            </>
          )}
          <button className="btn btn-primary" aria-busy={pending}>
            {pending
              ? "Đang xử lý…"
              : flow
                ? "Xác minh và tiếp tục"
                : "Đăng ký"}
          </button>
          {flow ? (
            <div className="btn-group">
              <button
                type="button"
                className="btn"
                onClick={() => void resend()}
              >
                Gửi lại mã
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFlow("");
                  setOtp("");
                }}
              >
                Đăng ký lại
              </button>
            </div>
          ) : null}
        </fieldset>
        {error ? (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="notice">
            {notice}
          </p>
        ) : null}
        <Link href="/login">Đã có tài khoản? Đăng nhập</Link>
      </form>
    </section>
  );
}
