"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestApi } from "../../lib/apiClient";
import { publicAuth, person1Error } from "../../lib/person1Api";
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await requestApi("/auth/forgot-password", {
        ...publicAuth,
        method: "POST",
        body: { email: email.trim() },
      });
      setDone(true);
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="page-section">
      <h1>Quên mật khẩu</h1>
      <form className="card form-stack" onSubmit={submit}>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            maxLength={200}
            required
            disabled={pending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Đang gửi…" : "Gửi hướng dẫn đặt lại"}
        </button>
        {done ? (
          <p role="status">
            Nếu email đủ điều kiện, bạn sẽ nhận được liên kết đặt lại mật khẩu.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        ) : null}
        <Link href="/login">Quay lại đăng nhập</Link>
      </form>
    </section>
  );
}
