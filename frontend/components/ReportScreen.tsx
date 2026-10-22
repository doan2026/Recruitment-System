"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCurrentAccount } from "./SessionGate";
import { requestApi } from "../lib/apiClient";
import { person1Error, person1FormError } from "../lib/person1Api";
import { LoadingState, PageHeader } from "./ui";

export default function ReportScreen() {
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
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const validation = person1FormError(e.currentTarget);
    if (validation) { setError(validation); return; }
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
  if (account === undefined) return <LoadingState label="Đang kiểm tra phiên đăng nhập" />;
  if (!account)
    return (
      <section className="card stack">
        <PageHeader title="Đăng nhập để báo cáo vi phạm" description="Đăng nhập để gửi nội dung cần quản trị viên kiểm tra." />
        <Link className="btn btn-primary" href={`/login?returnTo=${encodeURIComponent("/reports" + (typeof window !== "undefined" ? window.location.search : ""))}`}>Đăng nhập</Link>
      </section>
    );
  return (
    <main className="form-stack">
      <PageHeader eyebrow="HỖ TRỢ" title="Báo cáo vi phạm" description="Gửi thông tin cụ thể để quản trị viên kiểm tra và xử lý." />
      <form className="card form-stack" onSubmit={submit} noValidate>
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
              className="textarea resize-none"
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
              className="textarea resize-none"
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
          <p role="status" className="notice notice-success">
            Báo cáo đã được ghi nhận để quản trị viên xem xét.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
