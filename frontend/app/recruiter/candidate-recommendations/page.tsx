"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../../components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import { getRecruiterJobs, type Job } from "../../../lib/person2Api";
import { RecruiterCandidateRecommendations } from "../jobs/RecruiterCandidateRecommendations";

export default function RecruiterCandidateRecommendationsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getRecruiterJobs(controller.signal)
      .then((response) => {
        if (!active) return;
        setJobs(response.data);
        setJobId((current) => response.data.some((job) => job.id === current) ? current : response.data.find((job) => job.status === "PUBLISHED")?.id ?? response.data[0]?.id ?? "");
      })
      .catch((reason: unknown) => { if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) setError(toUserMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reloadKey]);
  const selected = jobs.find((job) => job.id === jobId);
  return (
    <main>
      <PageHeader title="Ứng viên gợi ý" description="Chọn tin bạn quản lý để xem các ứng viên đã đồng ý cho phép khám phá." />
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {!loading && !error && jobs.length === 0 ? <EmptyState title="Chưa có tin tuyển dụng" description="Tạo và gửi tin duyệt trước khi tìm ứng viên phù hợp." href="/recruiter/jobs/new" action="Tạo tin mới" /> : null}
      {jobs.length > 0 ? <div className="panel field"><label className="label" htmlFor="candidate-discovery-job">Tin tuyển dụng</label><select id="candidate-discovery-job" className="select" value={jobId} onChange={(event) => setJobId(event.target.value)}>{jobs.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.status}</option>)}</select></div> : null}
      {selected ? <RecruiterCandidateRecommendations key={selected.id} job={selected} /> : null}
    </main>
  );
}
