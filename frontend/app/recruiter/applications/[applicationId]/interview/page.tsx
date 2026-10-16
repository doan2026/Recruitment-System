"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { PageHeader, ErrorState, LoadingState } from "@/components/ui";
import { getApplicationDetail, type CandidateApplication } from "@/lib/person2Api";
import { toUserMessage } from "@/lib/apiClient";
import { interviewStartGmt7, scheduleInterview, type Interview } from "@/lib/interviewApi";

export default function ScheduleInterviewPage({ params }: { params: { applicationId: string } }) {
  const [application, setApplication] = useState<CandidateApplication | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState(""), [error, setError] = useState("");
  const [reload, setReload] = useState(0), [created, setCreated] = useState<Interview | null>(null);
  const [start, setStart] = useState(""), [location, setLocation] = useState(""), [notes, setNotes] = useState("");
  const [round, setRound] = useState(1), [duration, setDuration] = useState(45);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError("");
    getApplicationDetail(params.applicationId, controller.signal).then(r => setApplication(r.data))
      .catch(e => { if (!controller.signal.aborted) setLoadError(toUserMessage(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params.applicationId, reload]);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (pending || created) return; setError("");
    try {
      const scheduledStart = interviewStartGmt7(start);
      if (Date.parse(scheduledStart) <= Date.now()) throw new Error("Chọn thời gian trong tương lai.");
      if (!location.trim()) throw new Error("Nhập địa điểm phỏng vấn.");
      requestId.current ??= crypto.randomUUID(); setPending(true);
      const response = await scheduleInterview({ applicationId: params.applicationId,
        requestId: requestId.current, roundNumber: round, scheduledStart,
        timeZone: "Asia/Ho_Chi_Minh", durationMinutes: duration, mode: "OFFLINE",
        location: location.trim(), notes: notes.trim() || null });
      setCreated(response.data);
    } catch (e) { setError(e instanceof Error ? e.message : toUserMessage(e)); }
    finally { setPending(false); }
  }
  if (loading) return <main><LoadingState /></main>;
  if (loadError || !application) return <main><ErrorState message={loadError || "Không tìm thấy hồ sơ."} onRetry={() => setReload(v => v + 1)} /></main>;
  const eligible = ["REVIEWING", "INTERVIEW"].includes(application.status);
  return <main style={{ maxWidth: 650, margin: "0 auto" }}>
    <PageHeader eyebrow="ĐẶT LỊCH PHỎNG VẤN" title="Tạo lịch phỏng vấn mới" description={application.jobTitle} />
    {created ? <section className="card stack"><p role="status">Đã gửi lịch phỏng vấn thành công.</p>
      <p>{new Date(created.scheduledStart).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} (GMT+7) · {created.location}</p></section>
      : !eligible ? <p role="alert">Chỉ hồ sơ đang xét duyệt hoặc phỏng vấn mới có thể đặt lịch.</p>
      : <form className="card stack" onSubmit={submit}>
        <p>Phỏng vấn trực tiếp · Múi giờ Việt Nam (GMT+7)</p>
        <label className="field">Vòng phỏng vấn<input className="input" type="number" min={1} max={20} required value={round} onChange={e => setRound(Number(e.target.value))} disabled={pending} /></label>
        <label className="field">Thời gian dự kiến<input className="input" type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} disabled={pending} /></label>
        <label className="field">Thời lượng<select className="input" value={duration} onChange={e => setDuration(Number(e.target.value))} disabled={pending}>{[30, 45, 60].map(v => <option key={v} value={v}>{v} phút</option>)}</select></label>
        <label className="field">Địa điểm<input className="input" required maxLength={500} value={location} onChange={e => setLocation(e.target.value)} disabled={pending} /></label>
        <label className="field">Lời nhắn / Ghi chú<textarea className="input" rows={4} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} disabled={pending} /></label>
        {error && <p role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi lịch phỏng vấn"}</button>
      </form>}
    <Link className="btn" href={`/recruiter/applications/${params.applicationId}`}>Về hồ sơ ứng tuyển</Link>
  </main>;
}
