"use client";

import { applicationStatusLabel } from "@/lib/recruitmentLabels";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../../lib/apiClient";
import { getApplicationDetail, type CandidateApplication } from "../../../../lib/person2Api";

export default function CandidateApplicationDetailPage({ params }: { params: { applicationId: string } }) {
  const [application, setApplication] = useState<CandidateApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getApplicationDetail(params.applicationId, controller.signal)
      .then((response) => { if (active) setApplication(response.data); })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) setError(toUserMessage(reason));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [params.applicationId, reloadKey]);

  if (loading) return <main><LoadingState label="Đang tải hồ sơ ứng tuyển" /></main>;
  if (error || !application) return <main><ErrorState message={error || "Không tìm thấy hồ sơ ứng tuyển."} onRetry={() => setReloadKey((value) => value + 1)} /><Link className="btn" href="/candidate/applications">Về hồ sơ ứng tuyển</Link></main>;

  return (
    <main>
      <PageHeader title={application.jobTitle} description="Theo dõi tiến trình và phản hồi từ nhà tuyển dụng." action={<Link className="btn" href="/candidate/applications">Về hồ sơ ứng tuyển</Link>} />
      <section className="panel">
        <div className="section-head"><h2>Thông tin ứng tuyển</h2><StatusBadge tone={application.status === "HIRED" ? "success" : "info"}>{applicationStatusLabel(application.status)}</StatusBadge></div>
        <p>Nộp ngày <time dateTime={application.createdAt}>{new Date(application.createdAt).toLocaleString("vi-VN")}</time></p>
        {application.coverLetter ? <div><h3>Thư ứng tuyển</h3><p style={{ whiteSpace: "pre-wrap" }}>{application.coverLetter}</p></div> : null}
        <div className="btn-group">
          <Link className="btn" href={`/candidate/jobs/${application.jobId}`}>Xem việc làm</Link>
          {application.offerId ? <Link className="btn btn-primary" href={`/candidate/offers/${application.offerId}`}>Xem và phản hồi Offer</Link> : null}
        </div>
      </section>
      <section className="panel">
        <h2>Lịch sử hồ sơ</h2>
        <p className="help">Thời gian hiển thị theo múi giờ thiết bị của bạn.</p>
        {application.timeline?.length ? (
          <ol className="stack">
            {application.timeline.map((entry, index) => (
              <li key={`${entry.changedAt}-${index}`}>
                <strong>{entry.fromStatus ? `${applicationStatusLabel(entry.fromStatus)} → ` : ""}{applicationStatusLabel(entry.toStatus)}</strong>
                <p className="help"><time dateTime={entry.changedAt}>{new Date(entry.changedAt).toLocaleString("vi-VN")}</time></p>
                {entry.note ? <p style={{ whiteSpace: "pre-wrap" }}>{entry.note}</p> : null}
              </li>
            ))}
          </ol>
        ) : <p className="notice">Hồ sơ chưa có cập nhật tiến trình.</p>}
      </section>
    </main>
  );
}
