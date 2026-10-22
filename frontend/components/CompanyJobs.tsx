"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BriefcaseBusiness, CalendarDays, MapPin } from "lucide-react";
import { toUserMessage } from "@/lib/apiClient";
import { getPublicJobs, type Job } from "@/lib/person2Api";
import { jobTypeLabel } from "@/lib/recruitmentLabels";
import { EmptyState, ErrorState, LoadingState } from "./ui";

const PAGE_SIZE = 6;

function salaryLabel(job: Job) {
  if (job.isNegotiable) return "Lương thỏa thuận";
  const min = job.salaryMin.toLocaleString("vi-VN");
  const max = job.salaryMax?.toLocaleString("vi-VN");
  return max ? `${min} – ${max} ${job.currency}` : `Từ ${min} ${job.currency}`;
}

export function CompanyJobs({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getPublicJobs({ companyId, mode: "OFFSET", page, limit: PAGE_SIZE, sort: "NEWEST" }, controller.signal)
      .then(response => {
        if (controller.signal.aborted) return;
        setJobs(current => page === 1 ? response.data : [...new Map([...current, ...response.data].map(job => [job.id, job])).values()]);
        setTotal(typeof response.meta?.total === "number" ? response.meta.total : null);
        setHasMore(Boolean(response.meta?.hasMore));
      })
      .catch(reason => { if (!controller.signal.aborted) setError(toUserMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [companyId, page, reload]);

  return <section id="company-jobs" className="panel company-jobs" aria-labelledby="company-jobs-heading" aria-busy={loading}>
    <div className="section-head"><div><p className="eyebrow">CƠ HỘI TẠI {companyName}</p><h2 id="company-jobs-heading">Việc làm đang tuyển</h2></div>{total !== null ? <span className="badge badge-success">{total} vị trí</span> : null}</div>
    <p className="help">Các tin đang tuyển còn hạn nộp hồ sơ của công ty. Chọn một vị trí để xem chi tiết và ứng tuyển.</p>
    {error ? <ErrorState message={error} onRetry={() => setReload(value => value + 1)} /> : null}
    {loading ? <LoadingState label={page === 1 ? "Đang tải việc làm của công ty" : "Đang tải thêm việc làm"} /> : null}
    {!loading && !error && jobs.length === 0 ? <EmptyState title="Công ty chưa có tin đang tuyển" description="Bạn có thể quay lại sau hoặc khám phá thêm những cơ hội phù hợp khác." href="/candidate/jobs" action="Khám phá việc làm" /> : null}
    <div className="company-jobs-grid">
      {jobs.map(job => <Link prefetch={false} className="company-job-card" href={`/candidate/jobs/${job.id}?source=COMPANY_PAGE`} key={job.id}>
        <span className="company-job-icon" aria-hidden="true"><BriefcaseBusiness size={22} /></span>
        <div className="company-job-body"><h3>{job.title}</h3><strong className="company-job-salary">{salaryLabel(job)}</strong><div className="company-job-meta"><span><MapPin size={14} aria-hidden="true" />{job.location}</span><span>{jobTypeLabel(job.type)}</span><span><CalendarDays size={14} aria-hidden="true" />Hạn nộp {job.deadline.slice(0, 10).split("-").reverse().join("/")}</span></div><span className="text-link">Xem chi tiết <ArrowRight size={15} aria-hidden="true" /></span></div>
      </Link>)}
    </div>
    {!error && hasMore ? <button className="btn btn-secondary" type="button" disabled={loading} onClick={() => setPage(value => value + 1)}>Xem thêm việc làm của công ty</button> : null}
  </section>;
}
