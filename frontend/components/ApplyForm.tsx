"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { applicationCooldownView } from "../lib/applicationCooldown";
import { toUserMessage } from "../lib/apiClient";
import { getActiveCandidateCvs, isDemoPerson2Api, submitCandidateApplication, type ActiveCandidateCv } from "../lib/person2Api";
import { useCurrentAccount } from "./SessionGate";

type ApplicationSource = "SEARCH" | "AI_RECOMMENDATION" | "COMPANY_PAGE" | "SHARED_LINK" | "OTHER";

export function ApplyForm({ jobId, source = "SEARCH" }: { jobId: string; source?: ApplicationSource }) {
  const account = useCurrentAccount();
  const [cvs, setCvs] = useState<ActiveCandidateCv[]>([]);
  const [cvId, setCvId] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [loading, setLoading] = useState(true);
  const [cvError, setCvError] = useState("");
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [responseError, setResponseError] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const locked = useRef(false);

  useEffect(() => {
    if (!isDemoPerson2Api && account?.role !== "CANDIDATE") { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setCvError("");
    getActiveCandidateCvs(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setCvs(response.data);
        setCvId((current) => response.data.some((cv) => cv.id === current) ? current : (response.data.find((cv) => cv.isDefault) ?? response.data[0])?.id ?? "");
      })
      .catch((reason) => { if (!controller.signal.aborted) setCvError(toUserMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account?.id, account?.role, reload]);

  if (!isDemoPerson2Api && account?.role !== "CANDIDATE") return (
    <section id="apply" className="card">
      <h2>Ứng tuyển vị trí này</h2>
      <p>{account ? "Chỉ tài khoản ứng viên có thể gửi hồ sơ." : "Đăng nhập bằng tài khoản ứng viên để chọn CV và gửi hồ sơ."}</p>
      {!account ? <Link className="btn btn-primary" href={`/login?returnTo=${encodeURIComponent(`/candidate/jobs/${jobId}?source=${source}`)}`}>Đăng nhập để ứng tuyển</Link> : null}
    </section>
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || submitted || loading || cvError) return;
    if (!cvId || !cvs.some((cv) => cv.id === cvId)) {
      setMessage("Vui lòng chọn CV đang hoạt động."); document.getElementById("apply-cv")?.focus(); return;
    }
    locked.current = true; setPending(true); setResponseError(null); setMessage("");
    try {
      const response = await submitCandidateApplication({ jobId, cvId, coverLetter, source });
      setSubmitted(true);
      setMessage(`Đã gửi hồ sơ ứng tuyển. Trạng thái hiện tại: ${response.data.status}.`);
    } catch (reason) { setResponseError(reason); }
    finally { locked.current = false; setPending(false); }
  }
  const cooldown = applicationCooldownView(responseError);
  return (
    <form className="card form-stack" id="apply" noValidate onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="apply-cv">CV dùng để ứng tuyển</label>
        <select id="apply-cv" className="select" value={cvId} disabled={loading || pending || submitted} onChange={(event) => setCvId(event.target.value)} aria-describedby="apply-cv-help" aria-invalid={!!message && !cvId}>
          <option value="">{loading ? "Đang tải CV…" : "Chọn CV"}</option>
          {cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.title}{cv.isDefault ? " · Mặc định" : ""}</option>)}
        </select>
        <span id="apply-cv-help" className="help">Chỉ hiển thị CV còn hoạt động thuộc tài khoản của bạn.</span>
        {!loading && !cvError && cvs.length === 0 ? <p className="notice">Bạn chưa có CV hoạt động. <Link href="/candidate/profile/cvs">Xem hướng dẫn chuẩn bị CV</Link></p> : null}
        {cvError ? <div className="notice notice-danger" role="alert">{cvError} <button className="btn" type="button" onClick={() => setReload((value) => value + 1)}>Tải lại CV</button></div> : null}
      </div>
      <div className="field">
        <label className="label" htmlFor="apply-note">Thư ứng tuyển (tùy chọn)</label>
        <textarea id="apply-note" className="textarea resize-none" rows={4} maxLength={2000} value={coverLetter} disabled={pending || submitted} onChange={(event) => setCoverLetter(event.target.value)} />
        <span className="help">Tối đa 2.000 ký tự.</span>
      </div>
      <button className="btn btn-primary" type="submit" disabled={loading || !!cvError || !cvId || pending || submitted || cooldown !== null} aria-busy={pending}>
        {pending ? "Đang gửi…" : submitted ? "Đã ứng tuyển" : "Gửi ứng tuyển"}
      </button>
      {message ? <p className={submitted ? "notice notice-success" : "form-error"} role="status">{message}</p> : null}
      {submitted ? <Link className="btn" href="/candidate/applications">Theo dõi hồ sơ đã gửi</Link> : null}
      {cooldown ? <section className="notice notice-warning" role="alert">
        <strong>{cooldown.title}</strong><p>{cooldown.description}</p>
        <time dateTime={cooldown.eligibleAt}>Có thể nộp lại: {cooldown.eligibleAtLabel}</time>
      </section> : null}
      {responseError && !cooldown ? <p className="notice notice-danger" role="alert"><strong>Chưa gửi được hồ sơ.</strong> {toUserMessage(responseError)}</p> : null}
    </form>
  );
}
