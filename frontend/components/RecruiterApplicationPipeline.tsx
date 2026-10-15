"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiClientError, toUserMessage } from "../lib/apiClient";
import { aiMatchNotReadyView } from "../lib/aiMatchRecovery";
import { prepareConflictSnapshot, type ConflictSnapshot } from "../lib/conflictRecovery";
import { APPLICATION_CONFLICT_FIELDS, type ApplicationConflictDraft } from "../lib/person2ConflictFields";
import { recruiterApplicationActions, validateRecruiterApplicationStatus } from "../lib/applicationStateMachine";
import { normalizeRecruiterApplicationQuery, shouldRestartOffsetApplications, validateRecruiterApplicationFilters, type RecruiterApplicationFilterDraft } from "../lib/recruiterApplicationTable";
import { changeApplicationStatus, getApplicationDetail, getRecruiterApplications, refreshApplicationMatchScore, type CandidateApplication } from "../lib/person2Api";
import { ConflictRecoveryPanel } from "./ConflictRecoveryPanel";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "./ui";
import { RecruiterCvAccess } from "./RecruiterCvAccess";
import { RecruiterEvaluation } from "./RecruiterEvaluation";
import { createConversation } from "../lib/chatApi";
import { useRouter } from "next/navigation";

const DEFAULT_FILTERS: RecruiterApplicationFilterDraft = {
  status: "ALL",
  appliedFrom: "",
  appliedTo: "",
  skills: "",
  sort: "APPLIED_AT_DESC",
  size: 20,
};

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
  const [filterDraft, setFilterDraft] = useState<RecruiterApplicationFilterDraft>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<RecruiterApplicationFilterDraft>(DEFAULT_FILTERS);
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [driftNotice, setDriftNotice] = useState("");
  const [matchStates, setMatchStates] = useState<Record<string, { message: string; polling: boolean }>>({});
  const [conflict, setConflict] = useState<ConflictSnapshot<ApplicationConflictDraft, CandidateApplication> | null>(null);
  const [chattingId, setChattingId] = useState<string | null>(null);
  const router = useRouter();
  const expectedTotalRef = useRef<number | null>(null);
  const seenPageIdsRef = useRef<Map<number, Set<string>>>(new Map());
  const applicationsRef = useRef<CandidateApplication[]>([]);
  const matchPollTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    applicationsRef.current = applications;
  }, [applications]);

  useEffect(() => () => {
    matchPollTimersRef.current.forEach((timer) => clearTimeout(timer));
    matchPollTimersRef.current.clear();
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    const query = normalizeRecruiterApplicationQuery(jobId, filters, page);
    getRecruiterApplications(query, controller.signal)
      .then((response) => {
        if (!active) return;
        const actualTotal = Number(response.meta?.total ?? response.data.length);
        const actualTotalPages = Math.max(1, Number(response.meta?.totalPages ?? 1));
        const currentIds = response.data.map((application) => application.id);
        const seenOnOtherPages = new Set(
          [...seenPageIdsRef.current.entries()]
            .filter(([seenPage]) => seenPage !== page)
            .flatMap(([, ids]) => [...ids]),
        );
        if (shouldRestartOffsetApplications({ page, expectedTotal: expectedTotalRef.current, actualTotal, seenIds: seenOnOtherPages, currentIds })) {
          expectedTotalRef.current = null;
          seenPageIdsRef.current = new Map();
          setDriftNotice("Danh sách vừa có hồ sơ mới hoặc thay đổi giữa các trang. CareerHub đã quay về trang đầu để tránh bỏ sót/trùng dữ liệu.");
          setPage(0);
          return;
        }
        if (page === 0) {
          expectedTotalRef.current = actualTotal;
          seenPageIdsRef.current = new Map([[0, new Set(currentIds)]]);
        } else {
          seenPageIdsRef.current.set(page, new Set(currentIds));
        }
        setApplications(response.data);
        setTotal(actualTotal);
        setTotalPages(actualTotalPages);
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
  }, [filters, jobId, page, reloadKey]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateRecruiterApplicationFilters(filterDraft);
    if (validationError) {
      setFilterError(validationError);
      return;
    }
    setFilterError("");
    setDriftNotice("");
    expectedTotalRef.current = null;
    seenPageIdsRef.current = new Map();
    setPage(0);
    setFilters({ ...filterDraft });
  }

  function resetFilters() {
    const defaults = { ...DEFAULT_FILTERS };
    setFilterDraft(defaults);
    setFilters(defaults);
    setFilterError("");
    setDriftNotice("");
    expectedTotalRef.current = null;
    seenPageIdsRef.current = new Map();
    setPage(0);
  }

  async function openApplicationConflict(
    error: unknown,
    application: CandidateApplication,
    localDraft: ApplicationConflictDraft,
  ): Promise<boolean> {
    try {
      const snapshot = await prepareConflictSnapshot({
        error,
        localDraft,
        localVersion: application.version,
        reload: async () => (await getApplicationDetail(application.id)).data,
        serverVersion: (server) => server.version,
        fields: APPLICATION_CONFLICT_FIELDS,
      });
      setApplications((current) => current.map((item) => item.id === application.id ? snapshot.server : item));
      setConflict(snapshot);
      setActionError("");
      return true;
    } catch {
      return false;
    }
  }

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
      setReloadKey((value) => value + 1);
    } catch (requestError: unknown) {
      const recovered = await openApplicationConflict(requestError, application, {
        intent: `Chuyển hồ sơ sang ${targetStatus}`,
        targetStatus,
        note: targetStatus === "REJECTED" ? reason?.trim() ?? "" : "",
        applicationVersion: application.version,
      });
      if (!recovered) setActionError(toUserMessage(requestError));
    } finally {
      setPendingApplicationId(null);
    }
  }

  async function refreshMatch(application: CandidateApplication, autoPollOnce = true) {
    if (pendingApplicationId) return;
    if (application.version === null) {
      setActionError("Response pipeline thiếu phiên bản Application. Hãy tải lại danh sách.");
      return;
    }
    const scheduled = matchPollTimersRef.current.get(application.id);
    if (scheduled) clearTimeout(scheduled);
    matchPollTimersRef.current.delete(application.id);
    setPendingApplicationId(application.id);
    setActionError("");
    setActionStatus("");
    setMatchStates((current) => {
      const next = { ...current };
      delete next[application.id];
      return next;
    });
    try {
      const response = await refreshApplicationMatchScore(application.id, application.version);
      setApplications((current) => current.map((item) => item.id === application.id ? {
        ...item,
        matchScore: response.data.matchScore,
        version: response.data.version,
      } : item));
      setActionStatus(`Đã cập nhật match score cho ${application.candidateName || "ứng viên"}.`);
    } catch (requestError: unknown) {
      const notReady = aiMatchNotReadyView(requestError);
      if (notReady) {
        setMatchStates((current) => ({ ...current, [application.id]: { message: notReady.message, polling: autoPollOnce } }));
        if (autoPollOnce) {
          const timer = setTimeout(() => {
            matchPollTimersRef.current.delete(application.id);
            const latest = applicationsRef.current.find((item) => item.id === application.id);
            setMatchStates((current) => current[application.id] ? {
              ...current,
              [application.id]: { ...current[application.id], polling: false },
            } : current);
            if (latest) void refreshMatch(latest, false);
          }, notReady.pollDelayMs);
          matchPollTimersRef.current.set(application.id, timer);
        }
      } else {
        const recovered = await openApplicationConflict(requestError, application, {
          intent: "Làm mới match score",
          targetStatus: application.status,
          note: "",
          applicationVersion: application.version,
        });
        if (!recovered) setActionError(toUserMessage(requestError));
      }
    } finally {
      setPendingApplicationId(null);
    }
  }

  async function startChat(application: CandidateApplication) {
    if (!application.candidateId) return;
    setChattingId(application.id);
    try {
      const response = await createConversation(`Chat với ${application.candidateName}`, [application.candidateId], false);
      router.push(`/messages?chat=${response.data.id}`);
    } catch (error) {
      console.error(error);
      alert("Không thể tạo cuộc trò chuyện: " + toUserMessage(error));
    } finally {
      setChattingId(null);
    }
  }

  return (
    <section className="panel">
      <div className="section-head row-between">
        <div><h2>Pipeline hồ sơ</h2><p className="help">Action được suy từ trạng thái backend; mọi mutation dùng optimistic version hiện tại.</p></div>
        {total ? <span className="badge">{total} hồ sơ</span> : null}
      </div>
      <form className="toolbar application-filter-toolbar" aria-label="Bộ lọc hồ sơ ứng tuyển" onSubmit={applyFilters} noValidate>
        <div className="field"><label className="label" htmlFor="application-status-filter">Trạng thái</label><select id="application-status-filter" className="select" value={filterDraft.status} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value as RecruiterApplicationFilterDraft["status"] }))}><option value="ALL">Tất cả</option><option value="APPLIED">APPLIED</option><option value="REVIEWING">REVIEWING</option><option value="INTERVIEW">INTERVIEW</option><option value="OFFER">OFFER</option><option value="HIRED">HIRED</option><option value="REJECTED">REJECTED</option><option value="WITHDRAWN">WITHDRAWN</option></select></div>
        <div className="field"><label className="label" htmlFor="application-from">Nộp từ ngày</label><input id="application-from" className="input" type="date" value={filterDraft.appliedFrom} onChange={(event) => setFilterDraft((current) => ({ ...current, appliedFrom: event.target.value }))} /></div>
        <div className="field"><label className="label" htmlFor="application-to">Nộp đến ngày</label><input id="application-to" className="input" type="date" value={filterDraft.appliedTo} onChange={(event) => setFilterDraft((current) => ({ ...current, appliedTo: event.target.value }))} /></div>
        <div className="field"><label className="label" htmlFor="application-skills">Kỹ năng</label><input id="application-skills" className="input" value={filterDraft.skills} placeholder="React, Java" onChange={(event) => setFilterDraft((current) => ({ ...current, skills: event.target.value }))} /></div>
        <div className="field"><label className="label" htmlFor="application-sort">Sắp xếp</label><select id="application-sort" className="select" value={filterDraft.sort} onChange={(event) => setFilterDraft((current) => ({ ...current, sort: event.target.value as RecruiterApplicationFilterDraft["sort"] }))}><option value="APPLIED_AT_DESC">Mới nộp trước</option><option value="APPLIED_AT_ASC">Cũ nộp trước</option><option value="MATCH_SCORE_DESC">Match score cao</option></select></div>
        <div className="field"><label className="label" htmlFor="application-size">Số dòng</label><select id="application-size" className="select" value={filterDraft.size} onChange={(event) => setFilterDraft((current) => ({ ...current, size: Number(event.target.value) }))}><option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></div>
        <div className="btn-group"><button className="btn btn-primary" type="submit" disabled={loading}>Áp dụng</button><button className="btn" type="button" disabled={loading} onClick={resetFilters}>Xóa lọc</button></div>
      </form>
      {filterError ? <p className="form-error" role="alert">{filterError}</p> : null}
      {driftNotice ? <p className="notice" role="status">{driftNotice}</p> : null}
      {conflict ? (
        <ConflictRecoveryPanel
          resourceName="Hồ sơ ứng tuyển"
          snapshot={conflict}
          onKeepDraft={() => {
            if (conflict.localDraft.note) setRejectionReasons((current) => ({ ...current, [conflict.server.id]: conflict.localDraft.note }));
            setConflict(null);
            setActionStatus("Đã giữ ý định trên bản Application mới nhất. Hãy kiểm tra trạng thái rồi chủ động chọn lại thao tác; CareerHub chưa tự gửi lại.");
          }}
          onUseServer={() => {
            setRejectionReasons((current) => { const next = { ...current }; delete next[conflict.server.id]; return next; });
            setConflict(null);
            setActionStatus("Đã dùng trạng thái Application mới nhất từ server.");
          }}
        />
      ) : null}
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
          const matchState = matchStates[application.id];
          return (
            <article className="card application-pipeline-card" key={application.id}>
              <div className="section-head row-between">
                <div><strong>{application.candidateName || "Ứng viên"}</strong><p className="help">Nộp ngày {new Date(application.createdAt).toLocaleDateString("vi-VN")} · Version {application.version ?? "thiếu"}</p></div>
                <StatusBadge tone={application.status === "HIRED" ? "success" : application.status === "REJECTED" || application.status === "WITHDRAWN" ? "danger" : "warning"}>{application.status}</StatusBadge>
              </div>
              <p className="help">Match score: {application.matchScore ?? "chưa sẵn sàng"}</p>
              <RecruiterCvAccess applicationId={application.id} />
              <RecruiterEvaluation applicationId={application.id} />
              {matchState ? (
                <p className="notice notice-warning" role="status">
                  <strong>AI chưa sẵn sàng.</strong> {matchState.message} {matchState.polling ? "CareerHub sẽ tự thử lại một lần sau 5 giây." : "Bạn có thể thử lại khi dữ liệu đã đồng bộ."}
                </p>
              ) : null}
              {hasRejectAction ? (
                <div className="field">
                  <label className="label" htmlFor={`reject-${application.id}`}>Lý do nếu từ chối</label>
                  <textarea id={`reject-${application.id}`} className="textarea resize-none" maxLength={2000} value={rejectionReasons[application.id] ?? ""} aria-describedby={validationErrors[application.id] ? `reject-error-${application.id}` : undefined} onChange={(event) => { setRejectionReasons((current) => ({ ...current, [application.id]: event.target.value })); setValidationErrors((current) => ({ ...current, [application.id]: "" })); }} />
                  {validationErrors[application.id] ? <span id={`reject-error-${application.id}`} className="form-error">{validationErrors[application.id]}</span> : null}
                </div>
              ) : null}
              <div className="btn-group">
                <button className="btn" type="button" disabled={pendingApplicationId !== null || matchState?.polling} aria-busy={pending && !matchState} onClick={() => { void refreshMatch(application); }}>
                  {pending && !matchState ? "Đang tính điểm…" : matchState?.polling ? "Đang chờ AI…" : "Làm mới match score"}
                </button>
                {actions.map((action) => action.kind === "SEND_OFFER" ? (
                  <Link key={action.kind} className="btn btn-primary" href={`/recruiter/applications/${application.id}/offer`}>{action.label}</Link>
                ) : (
                  <button key={action.status} className={action.status === "REJECTED" ? "btn btn-danger" : "btn btn-secondary"} type="button" disabled={pendingApplicationId !== null} aria-busy={pending} onClick={() => { void moveStatus(application, action.status); }}>{pending ? "Đang cập nhật…" : action.label}</button>
                ))}
                {application.candidateId ? (
                  <button className="btn" type="button" disabled={chattingId === application.id} onClick={() => startChat(application)}>
                    {chattingId === application.id ? "Đang tạo..." : "Chat với ứng viên"}
                  </button>
                ) : null}
              </div>
              {actions.length === 0 ? <p className="status-line">Không còn recruiter action hợp lệ ở trạng thái này.</p> : null}
            </article>
          );
        })}
      </div>
      {!loadError && total > 0 ? (
        <nav className="btn-group pagination-actions" aria-label="Phân trang hồ sơ ứng tuyển">
          <button className="btn" type="button" disabled={loading || page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Trang trước</button>
          <span className="badge badge-muted" role="status">Trang {page + 1}/{totalPages}</span>
          <button className="btn" type="button" disabled={loading || page + 1 >= totalPages} onClick={() => setPage((current) => current + 1)}>Trang sau</button>
        </nav>
      ) : null}
    </section>
  );
}
