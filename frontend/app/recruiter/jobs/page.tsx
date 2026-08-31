"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TransientRecoveryState } from "../../../components/TransientRecoveryState";
import { EmptyState, LoadingState, Metric, PageHeader, StatusBadge } from "../../../components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import { isRejectedRecruiterJob, recruiterJobActionLabel, recruiterJobActions, recruiterJobEditLabel, type RecruiterJobAction } from "../../../lib/jobLifecycle";
import { closeRecruiterJob, getCurrentCompanyMembership, getRecruiterJobs, submitJobForApproval, type CompanyMemberRole, type Job, type JobStatus } from "../../../lib/person2Api";
import { isRecruiterJobAccessDenied, recruiterJobScopeView } from "../../../lib/recruiterJobAccess";
import { buildRecruiterJobTable, type RecruiterJobSort } from "../../../lib/recruiterJobTable";

export default function RecruiterJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | JobStatus>("ALL");
  const [sort, setSort] = useState<RecruiterJobSort>("UPDATED_DESC");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [membershipRole, setMembershipRole] = useState<CompanyMemberRole | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [membershipError, setMembershipError] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [failureCount, setFailureCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setMembershipLoading(true);
    setMembershipError("");
    getCurrentCompanyMembership(controller.signal)
      .then((response) => {
        if (active) setMembershipRole(response.data.memberRole);
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
          setMembershipRole(null);
          setMembershipError(toUserMessage(reason));
        }
      })
      .finally(() => {
        if (active) setMembershipLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    getRecruiterJobs(controller.signal)
      .then((response) => {
        if (active) {
          setJobs(response.data);
          setFailureCount(0);
        }
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
          setLoadError(reason);
          setFailureCount((value) => value + 1);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const jobTable = useMemo(() => buildRecruiterJobTable(jobs, {
    query,
    status: statusFilter,
    sort,
    page,
    pageSize,
  }), [jobs, page, pageSize, query, sort, statusFilter]);

  async function runJobAction(job: Job, action: RecruiterJobAction) {
    if (pendingJobId) return;
    setPendingJobId(job.id);
    setActionError("");
    setActionStatus("");
    try {
      const response = action === "SUBMIT_FOR_APPROVAL" ? await submitJobForApproval(job.id) : await closeRecruiterJob(job.id);
      setJobs((current) => current.map((item) => item.id === job.id ? response.data : item));
      setActionStatus(action === "SUBMIT_FOR_APPROVAL" ? "Đã gửi tin cho admin duyệt." : "Đã đóng tin tuyển dụng.");
    } catch (reason: unknown) {
      setActionError(toUserMessage(reason));
      if (isRecruiterJobAccessDenied(reason)) setReloadKey((value) => value + 1);
    } finally {
      setPendingJobId(null);
    }
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

      {membershipLoading ? <p className="notice" role="status">Đang xác định phạm vi tin theo vai trò công ty…</p> : null}
      {!membershipLoading && membershipRole ? (() => {
        const scope = recruiterJobScopeView(membershipRole);
        return <p className={`notice notice-${scope.tone}`} role="status"><StatusBadge tone={scope.tone}>{scope.label}</StatusBadge> {scope.description}</p>;
      })() : null}
      {!membershipLoading && membershipError ? <p className="notice notice-warning" role="alert"><strong>Chưa xác định được phạm vi vai trò.</strong> {membershipError}</p> : null}

      <section className="toolbar" aria-label="Bộ lọc tin tuyển dụng">
        <div className="field search-field">
          <label className="label" htmlFor="recruiter-job-search">Tìm tin tuyển dụng</label>
          <input ref={searchRef} id="recruiter-job-search" className="input" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Tên vị trí, phòng ban, địa điểm, phụ trách" />
          {query ? <button className="clear-search" type="button" aria-label="Xóa từ khóa tìm kiếm" onClick={() => { setQuery(""); setPage(1); searchRef.current?.focus(); }}>×</button> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="job-status-filter">Trạng thái</label>
          <select id="job-status-filter" className="select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "ALL" | JobStatus); setPage(1); }}>
            <option value="ALL">Tất cả trạng thái</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="PENDING_APPROVAL">Chờ duyệt</option>
            <option value="PUBLISHED">Đang tuyển</option>
            <option value="CLOSED">Đã đóng</option>
            <option value="EXPIRED">Hết hạn</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="job-sort">Sắp xếp</label>
          <select id="job-sort" className="select" value={sort} onChange={(event) => { setSort(event.target.value as RecruiterJobSort); setPage(1); }}>
            <option value="UPDATED_DESC">Mới cập nhật</option>
            <option value="DEADLINE_ASC">Hạn nộp gần nhất</option>
            <option value="TITLE_ASC">Tên vị trí A–Z</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="job-page-size">Số dòng</label>
          <select id="job-page-size" className="select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
            <option value="5">5 dòng</option>
            <option value="10">10 dòng</option>
            <option value="20">20 dòng</option>
          </select>
        </div>
      </section>

      {actionStatus ? <p className="notice notice-success" role="status">{actionStatus}</p> : null}
      {actionError ? <p className="notice notice-danger" role="alert"><strong>Chưa đổi được trạng thái tin.</strong> {actionError}</p> : null}

      <section className="panel">
        <div className="list-meta"><strong>{jobTable.filteredCount} / {jobs.length} tin phù hợp</strong><span className="help">Chỉ tải `/jobs/mine` một lần; lọc, sắp xếp và phân trang tại trình duyệt</span></div>
        {loadError ? (
          <TransientRecoveryState
            error={loadError}
            failureCount={failureCount}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : null}
        {loading ? <LoadingState /> : null}
        {!loading && !loadError && jobTable.filteredCount === 0 ? <EmptyState title="Không có tin phù hợp" description="Thử xóa từ khóa hoặc đổi trạng thái lọc." /> : null}
        {!loading && !loadError && jobTable.filteredCount > 0 ? (
          <>
          <div className="table-wrap">
            <table className="data-table">
              <caption>Hiển thị tin {jobTable.from}–{jobTable.to} trong {jobTable.filteredCount} kết quả</caption>
              <thead><tr><th scope="col">Vị trí</th><th scope="col">Trạng thái</th><th scope="col">Hạn nộp</th><th scope="col">Phụ trách</th><th scope="col">Thao tác</th></tr></thead>
              <tbody>{jobTable.items.map((job) => (
                <tr key={job.id}>
                  <td>
                    <strong>{job.title}</strong><div className="help">{job.location} · {job.department}</div>
                    {isRejectedRecruiterJob(job.status, job.rejectionReason) ? (
                      <div className="job-rejection-summary" role="note">
                        <strong>Admin yêu cầu chỉnh sửa</strong>
                        <span>{job.rejectionReason}</span>
                      </div>
                    ) : null}
                  </td>
                  <td><StatusBadge tone={job.status === "PUBLISHED" ? "success" : job.status === "DRAFT" ? "neutral" : job.status === "EXPIRED" ? "danger" : "warning"}>{job.status}</StatusBadge></td>
                  <td>{new Date(job.deadline).toLocaleDateString("vi-VN")}</td>
                  <td>{job.ownerName}<div className="help">Người tạo tin</div></td>
                  <td><div className="btn-group">
                    <Link className="btn btn-ghost" href={`/recruiter/jobs/${job.id}`}>Pipeline</Link>
                    {job.status === "DRAFT" ? <Link className={isRejectedRecruiterJob(job.status, job.rejectionReason) ? "btn btn-warning" : "btn btn-ghost"} href={`/recruiter/jobs/${job.id}/edit`}>{recruiterJobEditLabel(job.status, job.rejectionReason)}</Link> : null}
                    {recruiterJobActions(job.status).map((action) => <button key={action} className={action === "CLOSE" ? "btn btn-warning" : "btn btn-secondary"} type="button" disabled={pendingJobId === job.id} aria-busy={pendingJobId === job.id} onClick={() => { void runJobAction(job, action); }}>{pendingJobId === job.id ? "Đang xử lý…" : recruiterJobActionLabel(action)}</button>)}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <nav className="btn-group pagination-actions" aria-label="Phân trang tin tuyển dụng">
            <button className="btn" type="button" disabled={jobTable.page <= 1} onClick={() => setPage(Math.max(1, jobTable.page - 1))}>Trang trước</button>
            <span className="badge badge-muted" role="status">Trang {jobTable.page}/{jobTable.totalPages}</span>
            <button className="btn" type="button" disabled={jobTable.page >= jobTable.totalPages} onClick={() => setPage(Math.min(jobTable.totalPages, jobTable.page + 1))}>Trang sau</button>
          </nav>
          </>
        ) : null}
      </section>
    </main>
  );
}
