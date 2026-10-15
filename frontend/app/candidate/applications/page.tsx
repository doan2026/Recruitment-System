"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import { candidateApplicationActions, type CandidateApplicationAction } from "../../../lib/applicationStateMachine";
import { getApplicationDetail, getApplications, withdrawCandidateApplication, type CandidateApplication } from "../../../lib/person2Api";

function fmtDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("vi-VN");
}

export default function CandidateApplicationsPage() {
  const router = useRouter();
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getApplications(undefined, controller.signal)
      .then((response) => {
        if (active) setApplications(response.data);
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
          setLoadError(toUserMessage(reason));
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

  async function withdraw(application: CandidateApplication) {
    if (pendingApplicationId) return;
    setPendingApplicationId(application.id);
    setActionError("");
    setActionStatus("");
    try {
      const detail = await getApplicationDetail(application.id);
      if (detail.data.version === null) throw new ApiClientError({ code: "INVALID_API_RESPONSE" });
      const response = await withdrawCandidateApplication(application.id, {
        note: "Ứng viên chủ động rút hồ sơ",
        applicationVersion: detail.data.version,
      });
      setApplications((current) => current.map((item) => item.id === application.id ? {
        ...item,
        status: response.data.toStatus,
        version: response.data.version,
        notes: "Ứng viên chủ động rút hồ sơ",
      } : item));
      setActionStatus(`Đã rút hồ sơ ứng tuyển ${application.jobTitle}.`);
    } catch (reason: unknown) {
      setActionError(toUserMessage(reason));
    } finally {
      setPendingApplicationId(null);
    }
  }

  function runAction(application: CandidateApplication, action: CandidateApplicationAction) {
    if (action.kind === "WITHDRAW") {
      void withdraw(application);
      return;
    }
    setActionError("");
    router.push(application.offerId ? `/candidate/offers/${application.offerId}` : `/candidate/applications/${application.id}`);
  }

  return (
    <main>
      <PageHeader eyebrow="CANDIDATE · APPLICATIONS" title="Hồ sơ ứng tuyển của tôi" description="Theo dõi trạng thái và chỉ thực hiện những hành động hợp lệ ở bước hiện tại." />
      {actionStatus ? <p className="notice notice-success" role="status">{actionStatus}</p> : null}
      {actionError ? <p className="notice notice-danger" role="alert"><strong>Chưa hoàn tất thao tác.</strong> {actionError}</p> : null}
      {loadError ? <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {loading ? <LoadingState label="Đang tải hồ sơ ứng tuyển" /> : null}
      {!loading && !loadError && applications.length === 0 ? <EmptyState title="Chưa có hồ sơ ứng tuyển" description="Các công việc bạn đã ứng tuyển sẽ xuất hiện tại đây." /> : null}
      <section className="stack">
        {applications.map((application) => {
          const actions = candidateApplicationActions(application.status);
          const pending = pendingApplicationId === application.id;
          return (
            <article className="panel" key={application.id}>
              <div className="section-head row-between">
                <div><strong>{application.jobTitle}</strong><p className="help">{application.companyName}</p></div>
                <StatusBadge tone={application.status === "HIRED" ? "success" : application.status === "REJECTED" || application.status === "WITHDRAWN" ? "danger" : "warning"}>{application.status}</StatusBadge>
              </div>
              <p className="help">Match {application.matchScore ?? "chưa có"}% · Nộp ngày {fmtDate(application.createdAt)} · Phiên bản {application.version ?? "tải khi thao tác"}</p>
              <div className="btn-group">
                <Link className="btn" href={`/candidate/applications/${application.id}`}>Xem chi tiết và lịch sử</Link>
                {actions.map((action) => (
                  <button key={action.kind} className={action.kind === "RESPOND_OFFER" ? "btn btn-primary" : "btn btn-warning"} type="button" disabled={pendingApplicationId !== null} aria-busy={pending && action.kind === "WITHDRAW"} onClick={() => runAction(application, action)}>
                    {pending && action.kind === "WITHDRAW" ? "Đang rút hồ sơ…" : action.label}
                  </button>
                ))}
              </div>
              {actions.length === 0 ? <p className="status-line">Hồ sơ ở trạng thái kết thúc, không còn hành động khả dụng.</p> : null}
              {application.notes ? <p className="help">Ghi chú: {application.notes}</p> : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
