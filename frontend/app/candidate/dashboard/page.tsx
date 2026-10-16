"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Person1Gate } from "@/components/Person1Gate";
import { ErrorState, LoadingState, PageHeader } from "@/components/ui";
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
    <PageHeader eyebrow="CANDIDATE" title="Dashboard Ứng viên" description="Tổng quan về hành trình tìm việc của bạn." />
    {error ? <ErrorState message={error} onRetry={() => setReload(n => n + 1)} /> : !counts ? <LoadingState label="Đang tải tổng quan" /> :
      <section className="grid" aria-label="Thống kê của tôi">
        <Link className="card" href="/candidate/bookmarks"><h2>Việc đã lưu</h2><strong>{counts.saved}</strong></Link>
        <Link className="card" href="/candidate/applications"><h2>Hồ sơ đã nộp</h2><strong>{counts.applied}</strong></Link>
        <Link className="card" href="/candidate/interviews"><h2>Phỏng vấn sắp tới</h2><strong>{counts.interviews}</strong></Link>
      </section>}
    <Link className="btn btn-primary" href="/candidate/jobs">Tìm việc phù hợp</Link>
  </main>;
}

export default function CandidateDashboardPage() {
  return <Person1Gate role="CANDIDATE"><Dashboard /></Person1Gate>;
}
