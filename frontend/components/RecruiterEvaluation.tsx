"use client";

import { FormEvent, useState } from "react";
import { toUserMessage } from "../lib/apiClient";
import { isEvaluationAlreadyExists, normalizeEvaluationDraft, type EvaluationDraft } from "../lib/applicationEvaluation";
import { createApplicationEvaluation } from "../lib/person2Api";
import { StatusBadge } from "./ui";

const EMPTY_DRAFT: EvaluationDraft = { score: "", technical: "", communication: "", culture: "", note: "" };

export function RecruiterEvaluation({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EvaluationDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState(false);
  const [evaluated, setEvaluated] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || evaluated) return;
    setError("");
    let payload;
    try {
      payload = normalizeEvaluationDraft(draft);
    } catch (reason: unknown) {
      setError(toUserMessage(reason));
      return;
    }
    setPending(true);
    try {
      await createApplicationEvaluation(applicationId, payload);
      setEvaluated(true);
      setOpen(false);
    } catch (reason: unknown) {
      if (isEvaluationAlreadyExists(reason)) {
        setEvaluated(true);
        setOpen(false);
      } else {
        setError(toUserMessage(reason));
      }
    } finally {
      setPending(false);
    }
  }

  if (evaluated) {
    return <div className="btn-group"><StatusBadge tone="success">Đã đánh giá</StatusBadge><span className="help">Application API không có GET evaluation; trạng thái được ghi nhớ từ POST/409 trong phiên này.</span></div>;
  }

  return (
    <div>
      <button className="btn" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Đóng đánh giá" : "Đánh giá ứng viên"}</button>
      {open ? (
        <form className="form-stack evaluation-form" onSubmit={submit} noValidate>
          <div className="form-grid">
            {([
              ["score", "Điểm tổng"],
              ["technical", "Kỹ thuật"],
              ["communication", "Giao tiếp"],
              ["culture", "Phù hợp văn hóa"],
            ] as const).map(([field, label]) => (
              <div className="field" key={field}>
                <label className="label" htmlFor={`evaluation-${field}-${applicationId}`}>{label}</label>
                <input id={`evaluation-${field}-${applicationId}`} className="input" type="number" min="0" max="100" step="0.01" value={draft[field]} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
              </div>
            ))}
            <div className="field span-2"><label className="label" htmlFor={`evaluation-note-${applicationId}`}>Ghi chú nội bộ</label><textarea id={`evaluation-note-${applicationId}`} className="textarea resize-none" maxLength={2000} value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></div>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Đang lưu…" : "Lưu đánh giá"}</button>
        </form>
      ) : null}
    </div>
  );
}
