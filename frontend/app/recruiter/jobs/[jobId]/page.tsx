"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RecruiterApplicationPipeline } from "../../../../components/RecruiterApplicationPipeline";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "../../../../components/ui";
import { ApiClientError, toUserMessage } from "../../../../lib/apiClient";
import { getRecruiterJob, type Job } from "../../../../lib/person2Api";
import { RecruiterCandidateRecommendations } from "../RecruiterCandidateRecommendations";

export default function RecruiterJobPipelinePage({ params }: { params: { jobId: string } }) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getRecruiterJob(params.jobId, controller.signal)
      .then((response) => { if (active) setJob(response.data); })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) setError(toUserMessage(reason));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [params.jobId, reloadKey]);

  if (loading) return <main><LoadingState label="Đang tải pipeline tuyển dụng" /></main>;
  if (error || !job) return <main><ErrorState message={error || "Không tìm thấy tin tuyển dụng."} onRetry={() => setReloadKey((value) => value + 1)} /><Link className="btn" href="/recruiter/jobs">Về danh sách tin</Link></main>;
  return (
    <main>
      <PageHeader title={job.title} description="Theo dõi hồ sơ và khám phá ứng viên phù hợp." action={<div className="btn-group"><StatusBadge tone={job.status === "PUBLISHED" ? "success" : "warning"}>{job.status}</StatusBadge><Link className="btn" href="/recruiter/jobs">Về danh sách tin</Link></div>} />
      <RecruiterApplicationPipeline jobId={job.id} />
      <RecruiterCandidateRecommendations key={job.id} job={job} />
    </main>
  );
}
