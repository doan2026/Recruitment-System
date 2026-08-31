"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TransientRecoveryState } from "../../../../components/TransientRecoveryState";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../../../../components/ui";
import { ApiClientError, toUserMessage } from "../../../../lib/apiClient";
import { CANDIDATE_RECOMMENDATION_DEBOUNCE_MS, candidateRecommendationEmptyView } from "../../../../lib/candidateRecommendation";
import {
  getRecruiterCandidateRecommendations,
  getRecruiterJob,
  type Job,
  type RecruiterCandidateRecommendationResult,
} from "../../../../lib/person2Api";

export default function RecruiterJobPipelinePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [job, setJob] = useState<Job | null>(null);
  const [jobLoading, setJobLoading] = useState(true);
  const [jobError, setJobError] = useState("");
  const [jobReloadKey, setJobReloadKey] = useState(0);
  const [recommendations, setRecommendations] = useState<RecruiterCandidateRecommendationResult | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(true);
  const [recommendationError, setRecommendationError] = useState<unknown>(null);
  const [recommendationFailureCount, setRecommendationFailureCount] = useState(0);
  const [recommendationReloadKey, setRecommendationReloadKey] = useState(0);
  const recommendationRequestPendingRef = useRef(false);

  const retryRecommendations = useCallback(() => {
    if (recommendationRequestPendingRef.current) return;
    recommendationRequestPendingRef.current = true;
    setRecommendationReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setJobLoading(true);
    setJobError("");
    getRecruiterJob(jobId, controller.signal)
      .then((response) => {
        if (active) setJob(response.data);
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
          setJobError(toUserMessage(reason));
        }
      })
      .finally(() => {
        if (active) setJobLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [jobId, jobReloadKey]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    recommendationRequestPendingRef.current = true;
    setRecommendationLoading(true);
    setRecommendationError(null);
    debounceTimer = setTimeout(() => {
      getRecruiterCandidateRecommendations(jobId, { limit: 10 }, controller.signal)
        .then((response) => {
          if (active) {
            setRecommendations(response.data);
            setRecommendationFailureCount(0);
          }
        })
        .catch((reason: unknown) => {
          if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
            setRecommendationError(reason);
            setRecommendationFailureCount((value) => value + 1);
          }
        })
        .finally(() => {
          if (active) {
            recommendationRequestPendingRef.current = false;
            setRecommendationLoading(false);
          }
        });
    }, CANDIDATE_RECOMMENDATION_DEBOUNCE_MS);
    return () => {
      active = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      controller.abort();
      recommendationRequestPendingRef.current = false;
    };
  }, [jobId, recommendationReloadKey]);

  if (jobLoading) return <main><LoadingState label="Đang tải pipeline tuyển dụng" /></main>;
  if (jobError || !job) {
    return <main><ErrorState message={jobError || "Không tìm thấy tin tuyển dụng."} onRetry={() => setJobReloadKey((value) => value + 1)} /></main>;
  }

  const emptyView = recommendations?.items.length === 0 && recommendations.reason
    ? candidateRecommendationEmptyView(recommendations.reason)
    : null;

  return (
    <main>
      <PageHeader
        eyebrow="RECRUITER · CANDIDATE DISCOVERY"
        title={job.title}
        description="Ứng viên gợi ý chỉ đến từ tập đã bật consent khám phá và có dữ liệu AI tương thích."
        action={<div className="btn-group"><StatusBadge tone={job.status === "PUBLISHED" ? "success" : "warning"}>{job.status}</StatusBadge><Link className="btn" href="/recruiter/jobs">Về danh sách tin</Link></div>}
      />

      <section className="panel">
        <div className="section-head row-between">
          <div><h2>Ứng viên gợi ý</h2><p className="help">Xếp hạng theo độ phù hợp giữa embedding của tin và CV active.</p></div>
          {recommendations?.items.length ? <span className="badge">{recommendations.items.length} ứng viên</span> : null}
        </div>

        {recommendationLoading ? <LoadingState label="Đang đối chiếu tập ứng viên có consent" /> : null}
        {recommendationError ? (
          <TransientRecoveryState
            error={recommendationError}
            failureCount={recommendationFailureCount}
            onRetry={retryRecommendations}
          />
        ) : null}
        {!recommendationLoading && !recommendationError && emptyView ? (
          <div className="candidate-empty-state" role="status">
            <EmptyState title={emptyView.title} description={emptyView.description} />
            {emptyView.action === "EDIT_JOB" && job.status === "DRAFT" ? (
              <Link className="btn btn-primary" href={`/recruiter/jobs/${job.id}/edit`}>{emptyView.actionLabel}</Link>
            ) : (
              <button className="btn btn-secondary" type="button" disabled={recommendationLoading} aria-busy={recommendationLoading} onClick={retryRecommendations}>{recommendationLoading ? "Đang tìm lại…" : emptyView.action === "EDIT_JOB" ? "Tìm lại ứng viên" : emptyView.actionLabel}</button>
            )}
          </div>
        ) : null}
        {!recommendationLoading && !recommendationError && recommendations?.items.length ? (
          <div className="candidate-recommendation-grid">
            {recommendations.items.map((candidate) => (
              <article className="card candidate-recommendation-card" key={candidate.candidateId}>
                <div className="section-head row-between">
                  <div><strong>{candidate.fullName}</strong><p className="help">{candidate.headline || "Ứng viên chưa cập nhật headline"}</p></div>
                  <StatusBadge tone="success">{Math.round(candidate.score * 100)}% phù hợp</StatusBadge>
                </div>
                <meter className="match-meter" min="0" max="1" value={candidate.score} aria-label={`Mức phù hợp của ${candidate.fullName}`} />
                <div className="chip-list" aria-label="Kỹ năng nổi bật">
                  {candidate.skills.map((skill) => <span className="badge badge-neutral" key={skill}>{skill}</span>)}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
