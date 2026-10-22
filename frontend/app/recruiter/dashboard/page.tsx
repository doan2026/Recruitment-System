"use client";

import { applicationStatusLabel } from "@/lib/recruitmentLabels";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, Metric, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import { activeJobsMetricView, dashboardWarningView } from "../../../lib/applicationDegradedStates";
import { getCompany, getRecruiterDashboard, type RecruiterDashboard } from "../../../lib/person2Api";
import { ArrowRight, BriefcaseBusiness, Files, Building2 } from "lucide-react";

export default function RecruiterDashboardPage() {
  const [dashboard, setDashboard] = useState<RecruiterDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsCompany, setNeedsCompany] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNeedsCompany(false);
    getCompany(controller.signal)
      .then((company) => getRecruiterDashboard(company.data.id, controller.signal))
      .then((response) => {
        if (active) setDashboard(response.data);
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
          if (reason instanceof ApiClientError && reason.code === "COMPANY_NOT_FOUND") setNeedsCompany(true);
          else setError(toUserMessage(reason));
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

  const activeJobs = dashboard ? activeJobsMetricView(dashboard.summary.activeJobs) : null;

  return (
    <main>
      <PageHeader
        eyebrow="TỔNG QUAN TUYỂN DỤNG"
        title="Sức khỏe tuyển dụng"
        description="Theo dõi hiệu quả tuyển dụng, số lượng hồ sơ và tiến trình của từng vị trí."
        action={<Link className="btn btn-primary" href="/recruiter/jobs/new">Đăng tin tuyển dụng <ArrowRight size={16} /></Link>}
      />
      <div className="dashboard-quick-links"><Link href="/recruiter/jobs"><BriefcaseBusiness size={19} />Quản lý tin<ArrowRight size={16} /></Link><Link href="/recruiter/applications"><Files size={19} />Hồ sơ ứng tuyển<ArrowRight size={16} /></Link><Link href="/recruiter/company"><Building2 size={19} />Hồ sơ công ty<ArrowRight size={16} /></Link></div>
      {needsCompany && <section className="dashboard-welcome"><div><h2>Chào mừng đến không gian tuyển dụng</h2><p>Bắt đầu bằng hồ sơ công ty để đăng tin và kết nối với ứng viên.</p></div><Link className="btn btn-primary" href="/recruiter/company/new">Tạo hồ sơ công ty <ArrowRight size={16} /></Link></section>}
      {error ? <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {loading ? <LoadingState label="Đang tổng hợp số liệu tuyển dụng" /> : null}
      {dashboard ? (
        <>
          {dashboard.warnings.map((warning) => (
            <div className="notice notice-warning" role="status" key={warning.code}>
              <strong>Dữ liệu đang được hiển thị một phần.</strong> {dashboardWarningView(warning.code)}
            </div>
          ))}
          <section className="metric-grid" aria-label="Tóm tắt tuyển dụng">
            <Metric label="Tin đang tuyển" value={activeJobs?.value ?? "—"} detail={activeJobs?.detail} />
            <Metric label="Tổng hồ sơ" value={String(dashboard.summary.totalApplications)} detail="Trong kỳ đang xem" />
            <Metric label="Đã tuyển" value={String(dashboard.summary.hiredApplications)} detail="Ứng viên hoàn tất tuyển dụng" />
            <Metric label="Tỷ lệ tuyển" value={`${dashboard.summary.hiredRatePercent}%`} detail="Trên tổng hồ sơ" />
          </section>
          <section className="panel">
            <div className="section-head">
              <div><p className="eyebrow">TIẾN TRÌNH ỨNG TUYỂN</p><h2>Hồ sơ theo tin tuyển dụng</h2></div>
              <StatusBadge tone={activeJobs?.degraded ? "warning" : "success"}>{activeJobs?.degraded ? "Dữ liệu một phần" : "Đã cập nhật"}</StatusBadge>
            </div>
            {dashboard.applicationsByJob.length === 0 ? (
              <EmptyState title="Chưa có hồ sơ trong kỳ" description="Thống kê theo tin sẽ xuất hiện khi ứng viên nộp hồ sơ." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Tin tuyển dụng</th><th>Tổng hồ sơ</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {dashboard.applicationsByJob.map((job) => (
                      <tr key={job.jobId}>
                        <td><strong>{job.jobTitle}</strong></td>
                        <td>{job.totalApplications}</td>
                        <td><div className="chip-list">{Object.entries(job.statusCounts).map(([status, count]) => <span className="chip" key={status}>{applicationStatusLabel(status)}: {count}</span>)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
