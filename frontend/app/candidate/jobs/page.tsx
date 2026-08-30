"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "../../../components/ui";
import { toUserMessage } from "../../../lib/apiClient";
import {
  JobDataSource,
  Job,
  JobRecommendation,
  SearchMode,
  getPublicJobs,
  getRecommendationsForCandidate,
} from "../../../lib/person2Api";

function fmtDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("vi-VN");
}

export default function CandidateJobsPage() {
  const [mode, setMode] = useState<SearchMode>("OFFSET");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [responseSource, setResponseSource] = useState<JobDataSource | "">("");
  const [cursor, setCursor] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [recs, setRecs] = useState<JobRecommendation[]>([]);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");

    const debounce = setTimeout(() => {
      getPublicJobs({ q: query, mode, page, limit, cursor: cursor || null }, controller.signal)
        .then((resp) => {
          if (!active) return;
          setJobs(resp.data);
          setHasMore(!!resp.meta?.hasMore);
          setNextCursor(resp.meta?.nextCursor ?? null);
          setTotal(resp.meta?.total || 0);
          setResponseSource((resp.meta?.source as JobDataSource | undefined) ?? "");
        })
        .catch((reason: unknown) => {
          if (active) setError(toUserMessage(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });

      getRecommendationsForCandidate(controller.signal)
        .then((response) => {
          if (active) setRecs(response.data);
        })
        .catch((reason: unknown) => {
          if (active) setError(toUserMessage(reason));
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(debounce);
      controller.abort();
    };
  }, [query, mode, page, limit, cursor, reloadKey]);

  const overOffsetLimit = mode === "OFFSET" && page * limit > 10000;

  const recommendations = useMemo(() => {
    if (mode === "CURSOR" || recs.length === 0) return recs;
    return recs.map((item) => {
      const nextCursor = item.nextCursor === undefined ? "" : item.nextCursor;
      return { ...item, nextCursor: nextCursor || null };
    });
  }, [mode, recs]);

  function applyNextCursor() {
    if (!nextCursor) return;
    setCursor(nextCursor);
    setPage(1);
  }

  function resetToOffset() {
    setMode("OFFSET");
    setCursor("");
    setPage(1);
  }

  return (
    <main>
      <h1 className="page-title">Việc làm công khai</h1>
      <div className="panel">
        <div className="section-head row-wrap row-between">
          <div>
            <h2>Tìm kiếm + filter</h2>
            <p className="help">Search gọi `GET /jobs/search`; gợi ý gọi `GET /jobs/recommended` và luôn giữ dữ liệu nguồn.</p>
          </div>
          <span className="badge muted">Source: {responseSource || "Đang xác định"}</span>
        </div>
        <div className="toolbar">
          <div className="field search-field">
            <label className="label" htmlFor="candidate-job-search">Từ khóa</label>
            <input ref={searchRef} id="candidate-job-search" className="input" type="search" placeholder="Tên việc, địa điểm, phòng ban" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query ? <button className="clear-search" type="button" aria-label="Xóa từ khóa tìm kiếm" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>×</button> : null}
          </div>
          <div className="field"><label className="label" htmlFor="candidate-job-mode">Phân trang</label><select id="candidate-job-mode" className="select" value={mode} onChange={(e) => setMode(e.target.value as SearchMode)}>
            <option value="OFFSET">Theo trang</option><option value="CURSOR">Tải thêm</option>
          </select></div>
          <div className="field"><label className="label" htmlFor="candidate-job-limit">Số kết quả</label><select id="candidate-job-limit" className="select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={5}>5</option><option value={10}>10</option><option value={20}>20</option>
          </select></div>
          <button className="btn" type="button" onClick={resetToOffset}>Đặt lại</button>
        </div>
        {overOffsetLimit ? (
          <p className="form-error">Trang đã vượt ngưỡng 10.000 result; đề xuất chuyển sang cursor mode.</p>
        ) : null}
      </div>

      <section className="grid-2">
        <section className="panel">
          <div className="section-head row-between">
            <h2>Danh sách việc làm</h2>
            <span className="badge">Tổng {mode === "OFFSET" ? total : "-"}</span>
          </div>
          <div className="help">
            Trang của user role CANDIDATE có fallback khi danh sách rỗng; hiển thị source/CTA tương ứng.
          </div>

          {error ? <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
          {loading ? <p className="help">Đang tải...</p> : null}
          {!loading && !error && jobs.length === 0 ? <p className="help">Không có việc làm phù hợp.</p> : null}

          {jobs.map((job) => (
            <article className="job-item" key={job.id}>
              <div className="section-head">
                <div>
                  <strong>{job.title}</strong>
                  <p className="help">
                    {job.location} • {job.department} • {job.salaryMin.toLocaleString("vi-VN")} -
                    {job.salaryMax === null ? "Thỏa thuận" : `${job.salaryMax.toLocaleString("vi-VN")} VNĐ`}
                  </p>
                </div>
                <span className="badge">{job.source}</span>
              </div>
              <p className="help">Deadline: {fmtDate(job.deadline)}</p>
              <div className="btn-group">
                <Link className="btn btn-primary" href={`/candidate/jobs/${job.id}`}>
                  Xem chi tiết
                </Link>
                <Link className="btn" href={`/candidate/applications?job=${job.id}`}>
                  Nộp hồ sơ
                </Link>
              </div>
            </article>
          ))}

          {mode === "OFFSET" ? (
            <div className="btn-group" style={{ marginTop: 12 }}>
              <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Trước
              </button>
              <span className="badge muted">Page {page}</span>
              <button className="btn" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
                Sau
              </button>
            </div>
          ) : (
            <div className="btn-group" style={{ marginTop: 12 }}>
              <button className="btn" disabled={!hasMore} onClick={applyNextCursor}>
                Xem thêm (cursor)
              </button>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Gợi ý phù hợp</h2>
          <p className="help">Bám theo source của backend recommendation.</p>
          <div className="stack">
            {recommendations.map((item) => (
              <div key={item.id} className="card">
                <div className="section-head row-between">
                  <strong>{item.title}</strong>
                  <span className="badge">{item.source}</span>
                </div>
                <p className="help">Match {item.matchPercent}%</p>
                <p>{item.reasonText}</p>
                {item.fallbackReason ? <p className="status-line">Fallback: {item.fallbackReason}</p> : null}
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
