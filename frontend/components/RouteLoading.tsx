export function RouteLoading() {
  return <section className="route-loading" role="status" aria-label="Đang tải trang" aria-live="polite">
    <span className="skeleton-line skeleton-title" /><span className="skeleton-line short" />
    <div className="route-loading-grid">{[0,1,2].map(i => <div className="skeleton-card" key={i}><span className="skeleton-line short" /><span className="skeleton-line" /></div>)}</div>
    <div className="skeleton-card skeleton-panel"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>
    <span className="sr-only">Đang tải nội dung, vui lòng đợi.</span>
  </section>;
}
