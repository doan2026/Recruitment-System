"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatusBadge, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { interviewStatusLabel, listMyInterviews, type Interview } from "@/lib/interviewApi";
import { toUserMessage } from "@/lib/apiClient";

export default function CandidateInterviewsPage() {
  const [items, setItems] = useState<Interview[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    listMyInterviews(cursor, controller.signal)
      .then(r => { setItems(old => cursor ? [...new Map([...old, ...r.data.items].map(iv => [iv.id, iv])).values()] : r.data.items); setNextCursor(r.data.nextCursor); })
      .catch(e => { if (!controller.signal.aborted) setError(toUserMessage(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cursor, reload]);
  return <main>
    <PageHeader title="Lịch phỏng vấn" eyebrow="ỨNG VIÊN · PHỎNG VẤN" description="Theo dõi lịch và địa điểm phỏng vấn của bạn. Thời gian hiển thị theo GMT+7." />
    {error && <ErrorState message={error} onRetry={() => setReload(v => v + 1)} />}
    <section className="stack" aria-label="Danh sách lịch phỏng vấn">
    {items.map(iv => <article className="card stack" key={iv.id}>
      <div className="section-head"><h2>Phỏng vấn vòng {iv.roundNumber}</h2><StatusBadge tone={iv.status === "COMPLETED" ? "success" : iv.status === "CANCELLED" || iv.status === "NO_SHOW" ? "warning" : "info"}>{interviewStatusLabel(iv.status)}</StatusBadge></div>
      <p className="muted"><time dateTime={iv.scheduledStart}>{new Date(iv.scheduledStart).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time> (GMT+7) · {iv.durationMinutes} phút</p>
      <p>{iv.mode === "OFFLINE" ? "Phỏng vấn trực tiếp" : "Phỏng vấn trực tuyến"}{iv.location ? ` · ${iv.location}` : ""}</p>
      <div className="btn-group"><Link className="btn btn-secondary" href={`/candidate/applications/${iv.applicationId}`}>Xem đơn ứng tuyển</Link></div>
    </article>)}
    </section>
    {loading && <LoadingState />}
    {!loading && !error && items.length === 0 && <EmptyState title="Chưa có lịch phỏng vấn" description="Lịch do nhà tuyển dụng gửi sẽ hiển thị tại đây." href="/candidate/jobs" action="Tìm việc ngay" />}
    {!loading && nextCursor && <button className="btn" onClick={() => setCursor(nextCursor)}>Tải thêm lịch</button>}
  </main>;
}
