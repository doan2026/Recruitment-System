"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "@/lib/apiClient";
import { getRecruiterJob, type Job } from "@/lib/person2Api";
import { jobStatusLabel, jobTypeLabel } from "@/lib/recruitmentLabels";

export default function JobPreviewPage({ params }: { params: { jobId: string } }) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setJob(null);
    getRecruiterJob(params.jobId, controller.signal)
      .then((response) => { if (active) setJob(response.data); })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
          setError(toUserMessage(reason));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [params.jobId, reloadKey]);

  const salary = job
    ? job.isNegotiable
      ? "Thỏa thuận"
      : `${job.salaryMin.toLocaleString("vi-VN")} ${job.currency} – ${job.salaryMax === null ? "Chưa công bố" : `${job.salaryMax.toLocaleString("vi-VN")} ${job.currency}`}`
    : "";

  return (
    <main>
      <PageHeader
        eyebrow="TIN TUYỂN DỤNG"
        title="Xem trước tin tuyển dụng"
        description="Kiểm tra nội dung đã lưu trước khi quay lại quản lý và gửi duyệt tin."
        action={
          <div className="btn-group">
            {job ? <Link className="btn btn-secondary" href={`/recruiter/jobs/${params.jobId}/edit`}>Quay lại sửa</Link> : null}
            <Link className="btn btn-primary" href="/recruiter/jobs">Quản lý tin</Link>
          </div>
        }
      />
      {loading ? <LoadingState label="Đang tải nội dung tin tuyển dụng" /> : null}
      {error ? <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {job ? (
        <article className="panel stack">
          <div className="section-head">
            <div><h2>{job.title}</h2><p className="help">{job.location} · {jobTypeLabel(job.type)}</p></div>
            <StatusBadge tone={job.status === "PUBLISHED" ? "success" : "warning"}>{jobStatusLabel(job.status)}</StatusBadge>
          </div>
          <div className="grid-3">
            <div className="stat"><strong>Mức lương</strong><p>{salary}</p></div>
            <div className="stat"><strong>Kinh nghiệm</strong><p>{job.level}</p></div>
            <div className="stat"><strong>Hạn ứng tuyển</strong><p><time dateTime={job.deadline.slice(0, 10)}>{job.deadline.slice(0, 10).split("-").reverse().join("/")}</time></p></div>
          </div>
          <section><h3>Mô tả công việc</h3><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{job.description || "Chưa bổ sung mô tả."}</p></section>
          <section><h3>Yêu cầu ứng viên</h3>{job.requirements.length ? <ul>{job.requirements.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="help">Chưa bổ sung yêu cầu.</p>}</section>
          <section><h3>Quyền lợi</h3>{job.benefits.length ? <ul>{job.benefits.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="help">Chưa bổ sung quyền lợi.</p>}</section>
          {job.skills.length ? <section><h3>Kỹ năng</h3><div className="chip-list">{job.skills.map((skill, index) => <span className="chip" key={index}>{skill}</span>)}</div></section> : null}
          <p className="notice">Đây là bản xem trước nội dung đã lưu. Bạn có thể chỉnh sửa hoặc quản lý trạng thái tin ở bước tiếp theo.</p>
        </article>
      ) : null}
    </main>
  );
}
