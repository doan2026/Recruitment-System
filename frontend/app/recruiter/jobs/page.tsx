"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState, Metric, PageHeader, StatusBadge } from "../../../components/ui";
import { toUserMessage } from "../../../lib/apiClient";
import { getRecruiterJobs, type Job, type JobStatus } from "../../../lib/person2Api";

export default function RecruiterJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | JobStatus>("ALL");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getRecruiterJobs(controller.signal)
      .then((response) => {
        if (active) setJobs(response.data);
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(toUserMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const visibleJobs = useMemo(() => jobs.filter((job) => {
    const matchesQuery = `${job.title} ${job.location} ${job.department}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"));
    return matchesQuery && (statusFilter === "ALL" || job.status === statusFilter);
  }), [jobs, query, statusFilter]);

  function transition(jobId: string, nextStatus: JobStatus) {
    setJobs((current) => current.map((job) => job.id === jobId ? { ...job, status: nextStatus, aggregateVersion: job.aggregateVersion + 1 } : job));
  }

  return (
    <main>
      <PageHeader eyebrow="RECRUITER · JOBS" title="Quản lý tin tuyển dụng" description="Theo dõi vòng đời tin, quyền thành viên và pipeline ứng viên." action={<Link className="btn btn-primary" href="/recruiter/jobs/new">Tạo tin mới</Link>} />
      <section className="metric-grid">
        <Metric label="Tổng tin" value={String(jobs.length)} detail="Trong công ty" />
        <Metric label="Đang tuyển" value={String(jobs.filter((job) => job.status === "PUBLISHED").length)} detail="Công khai" />
        <Metric label="Chờ duyệt" value={String(jobs.filter((job) => job.status === "PENDING_APPROVAL").length)} detail="Đã gửi admin" />
        <Metric label="Hồ sơ mới" value="24" detail="7 ngày gần nhất" />
      </section>

      <section className="toolbar" aria-label="Bộ lọc tin tuyển dụng">
        <div className="field search-field">
          <label className="label" htmlFor="recruiter-job-search">Tìm tin tuyển dụng</label>
          <input ref={searchRef} id="recruiter-job-search" className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên vị trí, phòng ban, địa điểm" />
          {query ? <button className="clear-search" type="button" aria-label="Xóa từ khóa tìm kiếm" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>×</button> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="job-status-filter">Trạng thái</label>
          <select id="job-status-filter" className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | JobStatus)}>
            <option value="ALL">Tất cả trạng thái</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="PENDING_APPROVAL">Chờ duyệt</option>
            <option value="PUBLISHED">Đang tuyển</option>
            <option value="CLOSED">Đã đóng</option>
            <option value="EXPIRED">Hết hạn</option>
          </select>
        </div>
      </section>

      <section className="panel">
        <div className="list-meta"><strong>{visibleJobs.length} tin phù hợp</strong><span className="help">Dữ liệu được phân trang phía client theo hợp đồng /jobs/mine</span></div>
        {loadError ? <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
        {loading ? <LoadingState /> : null}
        {!loading && !loadError && visibleJobs.length === 0 ? <EmptyState title="Không có tin phù hợp" description="Thử xóa từ khóa hoặc đổi trạng thái lọc." /> : null}
        {!loading && !loadError && visibleJobs.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <caption>Danh sách tin tuyển dụng của TechVision</caption>
              <thead><tr><th scope="col">Vị trí</th><th scope="col">Trạng thái</th><th scope="col">Hạn nộp</th><th scope="col">Phụ trách</th><th scope="col">Thao tác</th></tr></thead>
              <tbody>{visibleJobs.map((job) => (
                <tr key={job.id}>
                  <td><strong>{job.title}</strong><div className="help">{job.location} · {job.department}</div></td>
                  <td><StatusBadge tone={job.status === "PUBLISHED" ? "success" : job.status === "DRAFT" ? "neutral" : job.status === "EXPIRED" ? "danger" : "warning"}>{job.status}</StatusBadge></td>
                  <td>{new Date(job.deadline).toLocaleDateString("vi-VN")}</td>
                  <td>{job.ownerName}<div className="help">{job.memberRole ?? "MEMBER"}</div></td>
                  <td><div className="btn-group">
                    <Link className="btn btn-ghost" href={`/recruiter/jobs/${job.id}`}>Pipeline</Link>
                    {job.status === "DRAFT" ? <button className="btn btn-secondary" type="button" onClick={() => transition(job.id, "PENDING_APPROVAL")}>Gửi đi chờ duyệt</button> : null}
                    {job.status === "PUBLISHED" ? <button className="btn btn-warning" type="button" onClick={() => transition(job.id, "CLOSED")}>Đóng tin</button> : null}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
