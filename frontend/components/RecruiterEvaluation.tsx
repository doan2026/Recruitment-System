"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiClientError, toUserMessage } from "../lib/apiClient";
import { isEvaluationAlreadyExists, normalizeEvaluationDraft, type EvaluationDraft } from "../lib/applicationEvaluation";
import { createApplicationEvaluation, getApplicationEvaluations, type ApplicationEvaluationResult } from "../lib/person2Api";
import { useCurrentAccount } from "./SessionGate";
import { ErrorState, LoadingState, StatusBadge } from "./ui";

const EMPTY_DRAFT: EvaluationDraft = { score: "", technical: "", communication: "", culture: "", note: "" };
const SCORE_LABELS = [["score", "Điểm tổng"], ["technical", "Kỹ thuật"], ["communication", "Giao tiếp"], ["culture", "Phù hợp văn hóa"]] as const;

export function RecruiterEvaluation({ applicationId }: { applicationId: string }) {
  const account = useCurrentAccount();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EvaluationDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState(false);
  const [ownSubmitted, setOwnSubmitted] = useState(false);
  const [evaluations, setEvaluations] = useState<ApplicationEvaluationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const evaluated = ownSubmitted || evaluations.some((evaluation) => evaluation.evaluatorId === account?.id);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getApplicationEvaluations(applicationId, controller.signal)
      .then((response) => { if (active) { setEvaluations(response.data); setLoaded(true); } })
      .catch((reason: unknown) => { if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) setLoadError(toUserMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, applicationId, reloadKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || evaluated || !loaded) return;
    setError("");
    let payload;
    try { payload = normalizeEvaluationDraft(draft); }
    catch (reason: unknown) {
      setError(toUserMessage(reason));
      document.getElementById(`evaluation-score-${applicationId}`)?.focus();
      return;
    }
    setPending(true);
    try {
      const response = await createApplicationEvaluation(applicationId, payload);
      setEvaluations((current) => [...current.filter((item) => item.id !== response.data.id), response.data]);
      setOwnSubmitted(true);
    } catch (reason: unknown) {
      if (isEvaluationAlreadyExists(reason)) { setOwnSubmitted(true); setReloadKey((value) => value + 1); }
      else setError(toUserMessage(reason));
    } finally { setPending(false); }
  }

  return (
    <div>
      <div className="btn-group"><button className="btn" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Đóng đánh giá" : "Xem và đánh giá ứng viên"}</button>{evaluated ? <StatusBadge tone="success">Bạn đã đánh giá</StatusBadge> : null}</div>
      {open ? (
        <section className="stack" aria-label="Đánh giá nội bộ">
          {loading ? <LoadingState label="Đang tải đánh giá" /> : null}
          {loadError ? <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
          {evaluations.map((evaluation) => (
            <article className="card" key={evaluation.id}>
              <strong>{evaluation.evaluatorId === account?.id ? "Đánh giá của bạn" : "Đánh giá của nhà tuyển dụng"}</strong>
              <p>Điểm tổng: {evaluation.score}/100</p>
              <p className="help">Kỹ thuật: {evaluation.criteria.technical ?? "—"} · Giao tiếp: {evaluation.criteria.communication ?? "—"} · Văn hóa: {evaluation.criteria.culture ?? "—"}</p>
              {evaluation.note ? <p style={{ whiteSpace: "pre-wrap" }}>{evaluation.note}</p> : null}
              <time className="help" dateTime={evaluation.createdAt}>{new Date(evaluation.createdAt).toLocaleString("vi-VN")}</time>
            </article>
          ))}
          {loaded && !loading && !loadError && evaluations.length === 0 ? <p className="help">Chưa có đánh giá cho hồ sơ này.</p> : null}
          {loaded && !loading && !loadError && !evaluated ? (
            <form className="form-stack evaluation-form" onSubmit={submit} noValidate>
              <div className="form-grid">
                {SCORE_LABELS.map(([field, label]) => (
                  <div className="field" key={field}>
                    <label className="label" htmlFor={`evaluation-${field}-${applicationId}`}>{label}</label>
                    <input id={`evaluation-${field}-${applicationId}`} className="input" type="number" min="0" max="100" step="0.01" disabled={pending} value={draft[field]} onChange={(event) => { setDraft((current) => ({ ...current, [field]: event.target.value })); setError(""); }} aria-describedby={error ? `evaluation-error-${applicationId}` : undefined} />
                  </div>
                ))}
                <div className="field span-2"><label className="label" htmlFor={`evaluation-note-${applicationId}`}>Ghi chú nội bộ</label><textarea id={`evaluation-note-${applicationId}`} className="textarea resize-none" maxLength={2000} disabled={pending} value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></div>
              </div>
              {error ? <p id={`evaluation-error-${applicationId}`} className="form-error" role="alert">{error}</p> : null}
              <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang lưu…" : "Lưu đánh giá"}</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
