"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestApi } from "../../lib/apiClient";
import { publicAuth, passwordError, person1Error } from "../../lib/person1Api";
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const problem = passwordError(password);
    if (problem || password !== confirm) {
      setError(problem ?? "Hai mật khẩu chưa trùng nhau.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await requestApi("/auth/reset-password", {
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
  return (
    <section className="page-section">
      <h1>Đặt lại mật khẩu</h1>
      <form className="card form-stack" onSubmit={submit}>
        {done ? (
          <p role="status">Mật khẩu đã được cập nhật. Hãy đăng nhập lại.</p>
        ) : (
          <>
            <label className="field">
              Mật khẩu mới
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                maxLength={128}
                disabled={pending}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="field">
              Nhập lại mật khẩu
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                maxLength={128}
                disabled={pending}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={pending || !token.current}
            >
              {pending ? "Đang lưu…" : "Lưu mật khẩu"}
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        ) : null}
        <Link href="/login">Đăng nhập</Link>
        <Link href="/forgot-password">Yêu cầu liên kết mới</Link>
      </form>
    </section>
  );
}
