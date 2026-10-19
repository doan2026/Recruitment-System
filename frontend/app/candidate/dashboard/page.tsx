"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Person1Gate } from "@/components/Person1Gate";
import { ErrorState, LoadingState, Metric, PageHeader } from "@/components/ui";
import { requestApi, toUserMessage } from "../../../lib/apiClient";
import type { InterviewPage } from "../../../lib/interviewApi";
import { getApplications, getCandidateBookmarks } from "../../../lib/person2Api";

function Dashboard() {
  const [counts, setCounts] = useState<{ saved: number; applied: number; interviews: string } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCounts(null); setError("");
    Promise.all([
      getCandidateBookmarks(controller.signal),
      getApplications(undefined, controller.signal),
      requestApi<InterviewPage>("/interviews/my", { privateData: true, signal: controller.signal,
        query: { period: "UPCOMING", limit: 20 } }),
    ]).then(([saved, applied, interviews]) => {
      if (!controller.signal.aborted) setCounts({ saved: saved.data.length, applied: applied.data.length,
        interviews: `${interviews.data.items.length}${interviews.data.nextCursor ? "+" : ""}` });
    }).catch(reason => { if (!controller.signal.aborted) setError(toUserMessage(reason)); });
    return () => controller.abort();
  }, [reload]);
  return <main>
    <PageHeader eyebrow="ỨNG VIÊN · TỔNG QUAN" title="Tổng quan ứng viên" description="Theo dõi việc đã lưu, hồ sơ ứng tuyển và lịch phỏng vấn của bạn." action={<Link className="btn btn-primary" href="/candidate/jobs">Tìm việc phù hợp</Link>} />
    {error ? <ErrorState message={error} onRetry={() => setReload(n => n + 1)} /> : !counts ? <LoadingState label="Đang tải tổng quan" /> :
      <section className="metric-grid metric-grid-3" aria-label="Thống kê của tôi">
        <Link className="metric-link" href="/candidate/bookmarks"><Metric label="Việc đã lưu" value={String(counts.saved)} /></Link>
        <Link className="metric-link" href="/candidate/applications"><Metric label="Hồ sơ đã nộp" value={String(counts.applied)} /></Link>
        <Link className="metric-link" href="/candidate/interviews"><Metric label="Phỏng vấn sắp tới" value={counts.interviews} /></Link>
      </section>}
    <section className="panel stack">
      <div className="section-head"><div><p className="eyebrow">HỒ SƠ NGHỀ NGHIỆP</p><h2>Sẵn sàng cho cơ hội tiếp theo</h2></div></div>
      <p className="muted">Cập nhật kinh nghiệm và chọn CV phù hợp trước khi gửi hồ sơ ứng tuyển.</p>
      <div className="btn-group"><Link className="btn btn-secondary" href="/candidate/profile">Cập nhật hồ sơ</Link><Link className="btn" href="/candidate/profile/cvs">Quản lý CV</Link></div>
    </section>
  </main>;
}

export default function CandidateDashboardPage() {
  return <Person1Gate role="CANDIDATE"><Dashboard /></Person1Gate>;
}
