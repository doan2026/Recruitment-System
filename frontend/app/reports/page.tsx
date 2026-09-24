"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCurrentAccount } from "../../components/SessionGate";
import { requestApi } from "../../lib/apiClient";
import { person1Error } from "../../lib/person1Api";
export default function ReportPage() {
  const account = useCurrentAccount();
  const [targetType, setType] = useState("JOB");
  const [targetId, setId] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const type = query.get("type");
    const id = query.get("id");
    if (type && ["JOB", "COMPANY", "USER"].includes(type)) setType(type);
    if (id) setId(id);
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setDone(false);
    try {
      await requestApi("/admin/reports", {
        method: "POST",
        privateData: true,
        body: { targetType, targetId, reason, description },
      });
      setDone(true);
      setReason("");
      setDescription("");
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  if (!account)
    return (
      <section className="card">
        <h1>Đăng nhập để báo cáo vi phạm</h1>
        <Link href="/login">Đăng nhập</Link>
      </section>
    );
  return (
    <section className="form-stack">
      <h1>Báo cáo vi phạm</h1>
      <form className="card form-stack" onSubmit={submit}>
        <fieldset className="person1-fieldset form-stack" disabled={pending}>
          <label className="field">
            Loại đối tượng
            <select
              className="select"
              value={targetType}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="JOB">Tin tuyển dụng</option>
              <option value="COMPANY">Công ty</option>
              <option value="USER">Tài khoản</option>
            </select>
          </label>
          <label className="field">
            Mã đối tượng
            <input
              className="input"
              required
              pattern="[0-9a-fA-F-]{36}"
              value={targetId}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          <label className="field">
            Lý do
            <textarea
              className="textarea"
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="field">
            Mô tả bổ sung
            <textarea
              className="textarea"
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button className="btn btn-primary">
            {pending ? "Đang gửi…" : "Gửi báo cáo"}
          </button>
        </fieldset>
        {done ? (
          <p role="status">
            Báo cáo đã được ghi nhận để quản trị viên xem xét.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
