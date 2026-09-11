"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, LoadingState, StatusBadge } from "../../../components/ui";
import { TransientRecoveryState } from "../../../components/TransientRecoveryState";
import { ApiClientError } from "../../../lib/apiClient";
import { CANDIDATE_RECOMMENDATION_DEBOUNCE_MS, candidateRecommendationEmptyView } from "../../../lib/candidateRecommendation";
import { getRecruiterCandidateRecommendations, type Job, type RecruiterCandidateRecommendationResult } from "../../../lib/person2Api";

export function RecruiterCandidateRecommendations({ job }: { job: Job }) {
  const [result, setResult] = useState<RecruiterCandidateRecommendationResult | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [failureCount, setFailureCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState("");
  const pendingRef = useRef(false);
  const restartedRef = useRef(false);
  const available = job.status === "PUBLISHED" && job.deadline.slice(0, 10) >= new Date().toISOString().slice(0, 10);
  const retry = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!available) return;
    let active = true;
    const controller = new AbortController();
    pendingRef.current = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      getRecruiterCandidateRecommendations(job.id, { limit: 10, cursor }, controller.signal)
        .then((response) => {
          if (!active) return;
          setResult((current) => {
            if (!cursor || !current) return response.data;
            const items = new Map(current.items.map((item) => [item.candidateId, item]));
            for (const item of response.data.items) items.set(item.candidateId, item);
            return { ...response.data, items: [...items.values()] };
          });
          setFailureCount(0);
          restartedRef.current = false;
        })
        .catch((reason: unknown) => {
          if (!active || (reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) return;
          if (reason instanceof ApiClientError && reason.code === "RECOMMENDATION_CURSOR_STALE" && !restartedRef.current) {
            restartedRef.current = true;
            setNotice("Danh sách ứng viên đã thay đổi. Đang tải lại từ đầu.");
            setCursor(null);
            setReloadKey((value) => value + 1);
            return;
          }
          setError(reason);
          setFailureCount((value) => value + 1);
        })
        .finally(() => {
          if (active) { setLoading(false); pendingRef.current = false; }
        });
    }, CANDIDATE_RECOMMENDATION_DEBOUNCE_MS);
    return () => { active = false; clearTimeout(timer); controller.abort(); pendingRef.current = false; };
  }, [available, job.id, cursor, reloadKey]);

  const empty = result?.items.length === 0 && result.reason ? candidateRecommendationEmptyView(result.reason) : null;
  return (
    <section className="panel">
      <div className="section-head">
        <div><h2>Ứng viên gợi ý</h2><p className="help">Chỉ hiển thị người đã cho phép nhà tuyển dụng khám phá hồ sơ.</p></div>
        {result?.items.length ? <span className="badge">{result.items.length} ứng viên đã tải</span> : null}
      </div>
      {!available ? <p className="notice">Gợi ý ứng viên chỉ khả dụng khi tin đang công khai và còn hạn nhận hồ sơ.</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {loading ? <LoadingState label={result ? "Đang tải thêm ứng viên" : "Đang tìm ứng viên phù hợp"} /> : null}
      {error ? <TransientRecoveryState error={error} failureCount={failureCount} onRetry={retry} /> : null}
      {!loading && !error && empty ? <div><EmptyState title={empty.title} description={empty.description} />{empty.action === "EDIT_JOB" ? <Link className="btn" href={`/recruiter/jobs/${job.id}/edit`}>{empty.actionLabel}</Link> : <button className="btn" type="button" onClick={retry}>{empty.actionLabel}</button>}</div> : null}
      <div className="candidate-recommendation-grid">
        {result?.items.map((candidate) => (
          <article className="card candidate-recommendation-card" key={candidate.candidateId}>
            <div className="section-head"><div><strong>{candidate.fullName}</strong><p className="help">{candidate.headline || "Chưa cập nhật giới thiệu"}</p></div><StatusBadge tone="success">{Math.round(candidate.score * 100)}% phù hợp</StatusBadge></div>
            <meter className="match-meter" min="0" max="1" value={candidate.score} aria-label={`Mức phù hợp của ${candidate.fullName}`} />
            <div className="chip-list">{candidate.skills.map((skill) => <span className="badge badge-neutral" key={skill}>{skill}</span>)}</div>
          </article>
        ))}
      </div>
      {result?.nextCursor && result.nextCursor !== cursor ? <button className="btn btn-secondary" type="button" disabled={loading || !!error} onClick={() => { if (!pendingRef.current) { pendingRef.current = true; setCursor(result.nextCursor); } }}>Xem thêm ứng viên</button> : null}
      {result && result.items.length > 0 && !result.nextCursor && !loading ? <p className="help">Đã tải hết ứng viên trong danh sách gợi ý.</p> : null}
    </section>
  );
}
