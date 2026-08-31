"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui";
import { toUserMessage } from "../../lib/apiClient";
import { mergePublicCompanyPage, shouldLockCompanySearch } from "../../lib/companyPublicSearch";
import { type PublicCompanySummary, searchPublicCompanies } from "../../lib/person2Api";

export default function CompaniesPage() {
  const [draftQuery, setDraftQuery] = useState("");
  const [draftLimit, setDraftLimit] = useState(20);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [companies, setCompanies] = useState<PublicCompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [locked, setLocked] = useState(false);
  const [composing, setComposing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (locked || composing) return;
    const timer = window.setTimeout(() => {
      setQuery(draftQuery.trim());
      setLimit(draftLimit);
      setCursor(null);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [composing, draftLimit, draftQuery, locked]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    searchPublicCompanies({ q: query || undefined, limit, cursor }, controller.signal)
      .then((response) => {
        if (!active) return;
        setCompanies((current) => mergePublicCompanyPage(current, response.data, cursor !== null));
        setHasMore(Boolean(response.meta?.hasMore));
        setNextCursor(typeof response.meta?.nextCursor === "string" ? response.meta.nextCursor : null);
        setLocked(shouldLockCompanySearch(Boolean(response.meta?.hasMore), cursor));
      })
      .catch((reason: unknown) => { if (active) setError(reason); })
      .finally(() => {
        if (active) {
          setLoading(false);
          loadingRef.current = false;
        }
      });
    return () => { active = false; controller.abort(); };
  }, [cursor, limit, query, reloadKey]);

  const loadMore = useCallback(() => {
    if (!hasMore || !nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setCursor(nextCursor);
  }, [hasMore, nextCursor]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "160px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  function startNewSearch() {
    setLocked(false);
    setDraftQuery("");
    setDraftLimit(20);
    setQuery("");
    setLimit(20);
    setCursor(null);
    setNextCursor(null);
    setHasMore(false);
    setCompanies([]);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  return (
    <main>
      <PageHeader eyebrow="CANDIDATE · COMPANY" title="Khám phá doanh nghiệp" description="Tìm các công ty đã được xác minh và xem nơi phù hợp với định hướng của bạn." />
      <section className="panel">
        <div className="toolbar">
          <div className="field search-field">
            <label className="label" htmlFor="company-search">Tên công ty</label>
            <input ref={searchRef} id="company-search" className="input" type="search" value={draftQuery} disabled={locked} placeholder="Ví dụ: công nghệ, CareerHub" onCompositionStart={() => setComposing(true)} onCompositionEnd={(event) => { setComposing(false); setDraftQuery(event.currentTarget.value); }} onChange={(event) => setDraftQuery(event.target.value)} />
            {draftQuery && !locked ? <button className="clear-search" type="button" aria-label="Xóa từ khóa công ty" onClick={() => { setDraftQuery(""); searchRef.current?.focus(); }}>×</button> : null}
          </div>
          <div className="field">
            <label className="label" htmlFor="company-limit">Số kết quả mỗi lần</label>
            <select id="company-limit" className="select" value={draftLimit} disabled={locked} onChange={(event) => setDraftLimit(Number(event.target.value))}>
              <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
            </select>
          </div>
          {locked ? <button className="btn" type="button" onClick={startNewSearch}>Tìm kiếm mới</button> : null}
        </div>
        <p className="filter-note">Khi tải thêm, từ khóa và số lượng được khóa để cursor luôn hợp lệ.</p>
      </section>

      <section className="panel company-search-results" aria-busy={loading}>
        <div className="section-head"><h2>Doanh nghiệp đã xác minh</h2><span className="badge">{companies.length} đã tải</span></div>
        {error ? <ErrorState message={toUserMessage(error)} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
        {loading && companies.length === 0 ? <LoadingState label="Đang tìm công ty" /> : null}
        {!loading && !error && companies.length === 0 ? <EmptyState title="Chưa có công ty phù hợp" description="Thử từ khóa ngắn hơn hoặc xóa bộ lọc để xem tất cả doanh nghiệp." /> : null}
        <div className="grid-3">
          {companies.map((company) => (
            <Link className="card company-search-card" href={`/companies/${company.id}`} key={company.id} aria-label={`Xem hồ sơ ${company.name}`}>
              <div className="company-logo-placeholder" aria-hidden="true">{company.logoUrl ? <img src={company.logoUrl} alt="" /> : company.name.slice(0, 1).toUpperCase()}</div>
              <div><p className="eyebrow">ĐÃ XÁC MINH</p><h3>{company.name}</h3><p className="help">{company.industry} · {company.size}</p><p>{company.address}</p></div>
            </Link>
          ))}
        </div>
        {loading && companies.length > 0 ? <p className="status-line" role="status">Đang tải thêm doanh nghiệp…</p> : null}
        <div ref={sentinelRef} className="company-search-sentinel" aria-hidden="true" />
        {hasMore ? <button className="btn btn-secondary" type="button" disabled={loading} onClick={loadMore}>Tải thêm công ty</button> : companies.length > 0 ? <p className="status-line">Đã hiển thị hết kết quả.</p> : null}
      </section>
    </main>
  );
}
