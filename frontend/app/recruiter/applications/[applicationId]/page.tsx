"use client";

import { applicationStatusLabel } from "@/lib/recruitmentLabels";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatusBadge, LoadingState, ErrorState } from "@/components/ui";
import { RecruiterCvAccess } from "@/components/RecruiterCvAccess";
import { RecruiterEvaluation } from "@/components/RecruiterEvaluation";
import { getApplicationDetail, type CandidateApplication } from "@/lib/person2Api";
import { toUserMessage } from "@/lib/apiClient";

export default function RecruiterApplicationDetailPage({ params }: { params: { applicationId: string } }) {
  const [application, setApplication] = useState<CandidateApplication | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    getApplicationDetail(params.applicationId, controller.signal)
      .then(r => setApplication(r.data))
      .catch(e => { if (!controller.signal.aborted) setError(toUserMessage(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params.applicationId, reload]);
  if (loading) return <main><LoadingState /></main>;
  if (error || !application) return <main><ErrorState message={error || "Không tìm thấy hồ sơ."} onRetry={() => setReload(v => v + 1)} /></main>;
  return <main>
    <PageHeader eyebrow="CHI TIẾT HỒ SƠ" title={application.jobTitle} description="Xem hồ sơ, đánh giá và liên hệ ứng viên trong cùng một nơi."
      action={<div className="btn-group">
        {["REVIEWING", "INTERVIEW"].includes(application.status) && <Link className="btn btn-primary" href={`/recruiter/applications/${application.id}/interview`}>Đặt lịch phỏng vấn</Link>}
        {application.status === "INTERVIEW" && <Link className="btn" href={`/recruiter/applications/${application.id}/offer`}>Tạo Offer</Link>}
        <Link className="btn" href={`/recruiter/jobs/${application.jobId}`}>Hồ sơ theo tin</Link>
      </div>} />
    <section className="card stack"><h2>Thông tin ứng tuyển</h2><StatusBadge>{applicationStatusLabel(application.status)}</StatusBadge>
      <p>Nộp ngày {new Date(application.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>
      {application.coverLetter && <p style={{ whiteSpace: "pre-wrap" }}>{application.coverLetter}</p>}
      <RecruiterCvAccess applicationId={application.id} />
      <RecruiterEvaluation applicationId={application.id} />
    </section>
  </main>;
}
