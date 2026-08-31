"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../../../components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import { cursorRestartView } from "../../../lib/cursorRecovery";
import {
  emptyPublicJobSearchForm,
  isOffsetWindowTooDeep,
  mergePublicJobPage,
  normalizePublicJobSearch,
  publicJobSearchScope,
  validatePublicJobSearch,
  type PublicJobSearchFilters,
  type PublicJobSearchForm,
} from "../../../lib/publicJobSearch";
import { jobDataSourceView, recommendationFallbackView, recommendationSourceView } from "../../../lib/recommendationPresentation";
import {
  type JobDataSource,
  type Job,
  type JobRecommendation,
  type SearchMode,
  getPublicJobs,
  getRecommendationsForCandidate,
} from "../../../lib/person2Api";

function fmtDate(value?: string) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "-";
}

function RecommendationCard({
  item,
  loading,
  onRetry,
}: {
  item: JobRecommendation;
  loading: boolean;
  onRetry: () => void;
}) {
  const source = recommendationSourceView(item.source);
  const fallback = recommendationFallbackView(item.fallbackReason);
  return (
    <article className="card recommendation-card">
      <div className="section-head row-between"><strong>{item.title}</strong><StatusBadge tone={source.tone}>{source.label}</StatusBadge></div>
      <p className="help">{source.description}</p>
      <p className="help">Mức phù hợp {item.matchPercent}%</p>
      <p>{item.reasonText}</p>
      {fallback ? (
        <section className="recommendation-fallback" aria-label="Thông tin nguồn gợi ý dự phòng">
          <strong>{fallback.title}</strong>
          <p>{fallback.description}</p>
          {fallback.action === "UPLOAD_CV" ? (
            <Link className="btn btn-secondary" href="/candidate/profile/cvs">{fallback.actionLabel}</Link>
          ) : (
            <button className="btn btn-secondary" type="button" disabled={loading} onClick={onRetry}>{loading ? "Đang làm mới…" : fallback.actionLabel}</button>
          )}
        </section>
      ) : null}
    </article>
  );
}

export default function CandidateJobsPage() {
  const [form, setForm] = useState<PublicJobSearchForm>(emptyPublicJobSearchForm);
  const [filters, setFilters] = useState<PublicJobSearchFilters>(() => normalizePublicJobSearch(emptyPublicJobSearchForm));
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<SearchMode>("OFFSET");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [responseSource, setResponseSource] = useState<JobDataSource | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tooDeep, setTooDeep] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [recs, setRecs] = useState<JobRecommendation[]>([]);
  const [recommendationError, setRecommendationError] = useState("");
  const [searchRestartNotice, setSearchRestartNotice] = useState("");
  const [recommendationRestartNotice, setRecommendationRestartNotice] = useState("");
  const [recommendationReloadKey, setRecommendationReloadKey] = useState(0);
  const [recommendationLoading, setRecommendationLoading] = useState(true);
  const searchRestartedRef = useRef(false);
  const restoreListFocusRef = useRef(false);
  const jobListRef = useRef<HTMLElement>(null);
  const scope = useMemo(() => publicJobSearchScope(filters, limit), [filters, limit]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRecommendationLoading(true);
    setRecommendationError("");
    setRecommendationRestartNotice("");
    const continuation = mode === "CURSOR" && Boolean(cursor);
    setLoading(true);
    setError("");
    setTooDeep(false);
    getPublicJobs({ ...filters, mode, page, limit, cursor }, controller.signal)
      .then((response) => {
        if (!active) return;
        setJobs((current) => mergePublicJobPage(current, response.data, continuation));
        setHasMore(Boolean(response.meta?.hasMore));
        setNextCursor(response.meta?.nextCursor ?? null);
        setTotal(Number(response.meta?.total ?? 0));
        setResponseSource((response.meta?.source as JobDataSource | undefined) ?? "");
        searchRestartedRef.current = false;
        if (restoreListFocusRef.current) {
          restoreListFocusRef.current = false;
          requestAnimationFrame(() => jobListRef.current?.scrollIntoView({ block: "start" }));
        }
      })
      .catch((reason: unknown) => {
        if (!active || (reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) return;
        if (reason instanceof ApiClientError && reason.code === "JOB_SEARCH_PAGE_TOO_DEEP") {
          setTooDeep(true);
        } else if (reason instanceof ApiClientError && cursorRestartView(reason.code)?.code === "JOB_SEARCH_CURSOR_STALE" && !searchRestartedRef.current) {
          searchRestartedRef.current = true;
          restoreListFocusRef.current = true;
          setSearchRestartNotice(cursorRestartView(reason.code)?.message ?? "");
          setCursor(null);
          setPage(1);
          setNextCursor(null);
          setHasMore(false);
          if (!cursor) setReloadKey((value) => value + 1);
        } else {
          setError(toUserMessage(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [scope, filters, mode, page, limit, cursor, reloadKey]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function loadRecommendations(restarted = false): Promise<void> {
      try {
        const response = await getRecommendationsForCandidate(controller.signal);
        if (active) setRecs(response.data);
      } catch (reason: unknown) {
        if (!active || (reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) return;
        const restart = reason instanceof ApiClientError ? cursorRestartView(reason.code) : null;
        if (restart?.code === "RECOMMENDATION_CURSOR_STALE" && !restarted) {
          setRecommendationRestartNotice(restart.message);
          await loadRecommendations(true);
          return;
        }
        setRecommendationError(toUserMessage(reason));
      }
    }
    void loadRecommendations().finally(() => {
      if (active) setRecommendationLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [recommendationReloadKey]);

  function change<K extends keyof PublicJobSearchForm>(field: K, value: PublicJobSearchForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => {
      if (!(field in current) && !(field === "salaryMin" || field === "salaryMax")) return current;
      const next = { ...current };
      delete next[field];
      if (field === "salaryMin" || field === "salaryMax") delete next.salary;
      return next;
    });
  }

  function resetTraversal() {
    searchRestartedRef.current = false;
    restoreListFocusRef.current = false;
    setSearchRestartNotice("");
    setPage(1);
    setCursor(null);
    setNextCursor(null);
    setJobs([]);
    setHasMore(false);
    setTooDeep(false);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validatePublicJobSearch(form);
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
    resetTraversal();
    setFilters(normalizePublicJobSearch(form));
    setReloadKey((value) => value + 1);
  }

  function changeMode(nextMode: SearchMode) {
    if (nextMode === mode) return;
    resetTraversal();
    setMode(nextMode);
  }

  function changeLimit(nextLimit: number) {
    if (nextLimit === limit) return;
    resetTraversal();
    setLimit(nextLimit);
  }

  function resetFilters() {
    setForm(emptyPublicJobSearchForm);
    setFormErrors({});
    resetTraversal();
    setFilters(normalizePublicJobSearch(emptyPublicJobSearchForm));
    setReloadKey((value) => value + 1);
  }

  function switchToCursor() {
    resetTraversal();
    setMode("CURSOR");
  }

  const nextOffsetTooDeep = mode === "OFFSET" && isOffsetWindowTooDeep(page + 1, limit);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const searchSource = responseSource ? jobDataSourceView(responseSource) : null;

  return (
    <main>
      <PageHeader eyebrow="CANDIDATE · JOB SEARCH" title="Việc làm công khai" description="Lọc theo nhu cầu, chọn phân trang theo trang hoặc tải thêm bằng cursor ổn định." />

      <form className="panel form-grid" noValidate onSubmit={applyFilters}>
        <div className="field span-2">
          <label className="label" htmlFor="q">Từ khóa</label>
          <input id="q" className="input" type="search" placeholder="Tên vị trí hoặc nội dung công việc" value={form.q} onChange={(event) => change("q", event.target.value)} aria-invalid={!!formErrors.q} aria-describedby={formErrors.q ? "q-error" : undefined} />
          {formErrors.q ? <span id="q-error" className="form-error">{formErrors.q}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="location">Địa điểm</label>
          <input id="location" className="input" value={form.location} onChange={(event) => change("location", event.target.value)} aria-invalid={!!formErrors.location} aria-describedby={formErrors.location ? "location-error" : undefined} placeholder="Hà Nội, Remote…" />
          {formErrors.location ? <span id="location-error" className="form-error">{formErrors.location}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="jobType">Hình thức</label>
          <select id="jobType" className="select" value={form.jobType} onChange={(event) => change("jobType", event.target.value as PublicJobSearchForm["jobType"])}>
            <option value="">Tất cả</option><option value="FULL_TIME">Toàn thời gian</option><option value="PART_TIME">Bán thời gian</option><option value="CONTRACT">Hợp đồng</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="salary">Lương tối thiểu</label>
          <input id="salary" className="input" inputMode="decimal" value={form.salaryMin} onChange={(event) => change("salaryMin", event.target.value)} aria-invalid={!!formErrors.salary} aria-describedby={formErrors.salary ? "salary-error" : undefined} />
        </div>
        <div className="field">
          <label className="label" htmlFor="salaryMax">Lương tối đa</label>
          <input id="salaryMax" className="input" inputMode="decimal" value={form.salaryMax} onChange={(event) => change("salaryMax", event.target.value)} aria-invalid={!!formErrors.salary} aria-describedby={formErrors.salary ? "salary-error" : undefined} />
          {formErrors.salary ? <span id="salary-error" className="form-error">{formErrors.salary}</span> : null}
        </div>
        <div className="field span-2">
          <label className="label" htmlFor="skills">Kỹ năng, phân tách bằng dấu phẩy</label>
          <input id="skills" className="input" value={form.skills} onChange={(event) => change("skills", event.target.value)} aria-invalid={!!formErrors.skills} aria-describedby={formErrors.skills ? "skills-error" : undefined} placeholder="React, TypeScript" />
          {formErrors.skills ? <span id="skills-error" className="form-error">{formErrors.skills}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="experienceYears">Kinh nghiệm tối đa phù hợp</label>
          <input id="experienceYears" className="input" type="number" min="0" max="60" step="1" value={form.experienceYears} onChange={(event) => change("experienceYears", event.target.value)} aria-invalid={!!formErrors.experienceYears} aria-describedby={formErrors.experienceYears ? "experienceYears-error" : undefined} />
          {formErrors.experienceYears ? <span id="experienceYears-error" className="form-error">{formErrors.experienceYears}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="sort">Sắp xếp</label>
          <select id="sort" className="select" value={form.sort} onChange={(event) => change("sort", event.target.value as PublicJobSearchForm["sort"])}>
            <option value="RELEVANCE">Liên quan nhất</option><option value="NEWEST">Mới nhất</option><option value="SALARY_DESC">Lương cao nhất</option>
          </select>
        </div>
        <div className="span-2 btn-group"><button className="btn btn-primary" type="submit">Áp dụng bộ lọc</button><button className="btn" type="button" onClick={resetFilters}>Xóa bộ lọc</button></div>
      </form>

      <section className="toolbar" aria-label="Tùy chọn phân trang">
        <div className="field">
          <label className="label" htmlFor="candidate-job-mode">Cách xem kết quả</label>
          <select id="candidate-job-mode" className="select" value={mode} onChange={(event) => changeMode(event.target.value as SearchMode)}>
            <option value="OFFSET">Theo trang</option><option value="CURSOR">Tải thêm ổn định</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="candidate-job-limit">Kết quả mỗi lượt</label>
          <select id="candidate-job-limit" className="select" value={limit} onChange={(event) => changeLimit(Number(event.target.value))}>
            <option value={5}>5</option><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
          </select>
        </div>
        <p className="filter-note">Đổi bộ lọc, cách xem hoặc số kết quả sẽ bắt đầu lại từ đầu và bỏ cursor cũ.</p>
      </section>

      {tooDeep || (hasMore && nextOffsetTooDeep) ? (
        <section className="notice notice-warning" role="status">
          <strong>Đã tới giới hạn 10.000 kết quả của chế độ theo trang.</strong>
          <p>Chuyển sang tải thêm để đi sâu bằng cursor ổn định, hoặc bổ sung bộ lọc để thu hẹp danh sách.</p>
          <div className="btn-group"><button className="btn btn-primary" type="button" onClick={switchToCursor}>Chuyển sang tải thêm</button><button className="btn" type="button" onClick={() => document.getElementById("q")?.focus()}>Thu hẹp bộ lọc</button></div>
        </section>
      ) : null}
      {searchRestartNotice ? <p className="notice" role="status">{searchRestartNotice}</p> : null}

      <section className="grid-2">
        <section ref={jobListRef} className="panel" tabIndex={-1}>
          <div className="section-head row-between">
            <div><h2>Danh sách việc làm</h2><p className="help">Nguồn dữ liệu: {searchSource ? `${searchSource.label} — ${searchSource.description}` : "đang xác định"}</p></div>
            <span className="badge">{mode === "OFFSET" ? `${total} kết quả` : `${jobs.length} đã tải`}</span>
          </div>
          {error ? <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
          {loading && jobs.length === 0 ? <LoadingState label="Đang tìm việc làm phù hợp" /> : null}
          {!loading && !error && !tooDeep && jobs.length === 0 ? <EmptyState title="Chưa có việc làm phù hợp" description="Thử bỏ bớt kỹ năng, mở rộng địa điểm hoặc điều chỉnh khoảng lương." /> : null}
          <div className="stack">
            {jobs.map((job) => (
              <article className="job-item" key={job.id}>
                <div className="section-head">
                  <div>
                    <strong>{job.title}</strong>
                    <p className="help">{job.location} · {job.department} · {job.isNegotiable ? "Lương thỏa thuận" : `${job.salaryMin.toLocaleString("vi-VN")} – ${job.salaryMax?.toLocaleString("vi-VN")} VNĐ`}</p>
                  </div>
                  <StatusBadge tone={jobDataSourceView(job.source).tone}>{jobDataSourceView(job.source).label}</StatusBadge>
                </div>
                <p className="help">Hạn nộp: {fmtDate(job.deadline)}</p>
                <div className="btn-group"><Link className="btn btn-primary" href={`/candidate/jobs/${job.id}`}>Xem chi tiết</Link><Link className="btn" href={`/candidate/applications?job=${job.id}`}>Nộp hồ sơ</Link></div>
              </article>
            ))}
          </div>
          {loading && jobs.length > 0 ? <p className="help" role="status">Đang tải lượt tiếp theo…</p> : null}
          {mode === "OFFSET" ? (
            <nav className="btn-group pagination-actions" aria-label="Phân trang việc làm">
              <button className="btn" type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trang trước</button>
              <span className="badge muted">Trang {page}/{totalPages}</span>
              <button className="btn" type="button" disabled={loading || !hasMore || nextOffsetTooDeep} onClick={() => setPage((value) => value + 1)}>Trang sau</button>
            </nav>
          ) : (
            <div className="btn-group pagination-actions">
              <button className="btn btn-secondary" type="button" disabled={loading || !hasMore || !nextCursor} onClick={() => setCursor(nextCursor)}>{hasMore ? "Tải thêm việc làm" : "Đã tải hết kết quả"}</button>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Gợi ý phù hợp</h2>
          <p className="help">Mỗi thẻ ghi rõ nguồn xếp hạng. Khi dùng dữ liệu dự phòng, lý do và hành động phục hồi được hiển thị riêng.</p>
          {recommendationRestartNotice ? <p className="notice" role="status">{recommendationRestartNotice}</p> : null}
          {recommendationError ? <ErrorState message={recommendationError} /> : null}
          {recommendationLoading && recs.length === 0 ? <LoadingState label="Đang tải gợi ý việc làm" /> : null}
          <div className="stack">
            {recs.map((item) => <RecommendationCard key={item.id} item={item} loading={recommendationLoading} onRetry={() => setRecommendationReloadKey((value) => value + 1)} />)}
          </div>
        </section>
      </section>
    </main>
  );
}
