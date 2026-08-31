"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiClientError, toUserMessage } from "../lib/apiClient";
import { recruiterApplicationActions, validateRecruiterApplicationStatus } from "../lib/applicationStateMachine";
import { changeApplicationStatus, getApplicationsByJob, type CandidateApplication } from "../lib/person2Api";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "./ui";

export function RecruiterApplicationPipeline({ jobId }: { jobId: string }) {
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getApplicationsByJob(jobId, controller.signal)
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
  }, [jobId, reloadKey]);

  async function moveStatus(application: CandidateApplication, targetStatus: CandidateApplication["status"]) {
    if (pendingApplicationId) return;
    const reason = rejectionReasons[application.id];
    const validationError = validateRecruiterApplicationStatus(application.status, targetStatus, reason);
    if (validationError) {
      setValidationErrors((current) => ({ ...current, [application.id]: validationError }));
      return;
    }
    if (application.version === null) {
      setActionError("Response pipeline thiếu phiên bản Application. Hãy tải lại danh sách.");
      return;
    }
    setPendingApplicationId(application.id);
    setActionError("");
    setActionStatus("");
    setValidationErrors((current) => ({ ...current, [application.id]: "" }));
    try {
      const response = await changeApplicationStatus(application.id, {
        status: targetStatus,
        note: targetStatus === "REJECTED" ? reason : undefined,
        applicationVersion: application.version,
      });
      setApplications((current) => current.map((item) => item.id === application.id ? {
        ...item,
        status: response.data.toStatus,
        version: response.data.version,
        notes: targetStatus === "REJECTED" ? reason?.trim() : item.notes,
      } : item));
      setActionStatus(`Đã chuyển hồ sơ sang ${response.data.toStatus}.`);
    } catch (requestError: unknown) {
      setActionError(toUserMessage(requestError));
      if (requestError instanceof ApiClientError && requestError.code === "APPLICATION_CHANGED_CONCURRENTLY") {
        setReloadKey((value) => value + 1);
      }
    } finally {
      setPendingApplicationId(null);
    }
  }

  return (
    <section className="panel">
      <div className="section-head row-between">
        <div><h2>Pipeline hồ sơ</h2><p className="help">Action được suy từ trạng thái backend; mọi mutation dùng optimistic version hiện tại.</p></div>
        {applications.length ? <span className="badge">{applications.length} hồ sơ</span> : null}
      </div>
      {actionStatus ? <p className="notice notice-success" role="status">{actionStatus}</p> : null}
      {actionError ? <p className="notice notice-danger" role="alert"><strong>Chưa đổi được trạng thái.</strong> {actionError}</p> : null}
      {loadError ? <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {loading ? <LoadingState label="Đang tải pipeline hồ sơ" /> : null}
      {!loading && !loadError && applications.length === 0 ? <EmptyState title="Chưa có hồ sơ ứng tuyển" description="Hồ sơ mới sẽ xuất hiện tại đây sau khi ứng viên nộp thành công." /> : null}
      <div className="stack">
        {applications.map((application) => {
          const actions = recruiterApplicationActions(application.status);
          const hasRejectAction = actions.some((action) => action.kind === "STATUS" && action.status === "REJECTED");
          const pending = pendingApplicationId === application.id;
          return (
            <article className="card application-pipeline-card" key={application.id}>
              <div className="section-head row-between">
                <div><strong>{application.candidateName || "Ứng viên"}</strong><p className="help">Nộp ngày {new Date(application.createdAt).toLocaleDateString("vi-VN")} · Version {application.version ?? "thiếu"}</p></div>
                <StatusBadge tone={application.status === "HIRED" ? "success" : application.status === "REJECTED" || application.status === "WITHDRAWN" ? "danger" : "warning"}>{application.status}</StatusBadge>
              </div>
              <p className="help">Match score: {application.matchScore ?? "chưa sẵn sàng"}</p>
              {hasRejectAction ? (
                <div className="field">
                  <label className="label" htmlFor={`reject-${application.id}`}>Lý do nếu từ chối</label>
                  <textarea id={`reject-${application.id}`} className="textarea resize-none" maxLength={2000} value={rejectionReasons[application.id] ?? ""} aria-describedby={validationErrors[application.id] ? `reject-error-${application.id}` : undefined} onChange={(event) => { setRejectionReasons((current) => ({ ...current, [application.id]: event.target.value })); setValidationErrors((current) => ({ ...current, [application.id]: "" })); }} />
                  {validationErrors[application.id] ? <span id={`reject-error-${application.id}`} className="form-error">{validationErrors[application.id]}</span> : null}
                </div>
              ) : null}
              <div className="btn-group">
                {actions.map((action) => action.kind === "SEND_OFFER" ? (
                  <Link key={action.kind} className="btn btn-primary" href={`/recruiter/applications/${application.id}/offer`}>{action.label}</Link>
                ) : (
                  <button key={action.status} className={action.status === "REJECTED" ? "btn btn-danger" : "btn btn-secondary"} type="button" disabled={pendingApplicationId !== null} aria-busy={pending} onClick={() => { void moveStatus(application, action.status); }}>{pending ? "Đang cập nhật…" : action.label}</button>
                ))}
              </div>
              {actions.length === 0 ? <p className="status-line">Không còn recruiter action hợp lệ ở trạng thái này.</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
