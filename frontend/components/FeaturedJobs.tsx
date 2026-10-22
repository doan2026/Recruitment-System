"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BriefcaseBusiness, MapPin } from "lucide-react";
import type { Job } from "@/lib/person2Api";
import { ErrorState } from "./ui";

export function FeaturedJobs() {
  const section = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!section.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "240px" });
    observer.observe(section.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    import("@/lib/person2Api")
      .then(api => api.getPublicJobs({ mode: "OFFSET", page: 1, limit: 6, sort: "NEWEST" }, controller.signal))
      .then(result => { if (!controller.signal.aborted) setJobs(result.data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visible, reload]);
  return <section ref={section} className="home-section featured-jobs" aria-labelledby="new-jobs-heading"><div className="section-heading"><div><p className="eyebrow">CƠ HỘI ĐANG CHỜ BẠN</p><h2 id="new-jobs-heading">Việc làm mới nhất</h2></div><Link className="text-link" href="/candidate/jobs">Xem tất cả <ArrowRight size={16} /></Link></div>
    {failed ? <ErrorState message="Chưa tải được việc làm mới. Bạn có thể thử lại hoặc mở trang tìm việc." onRetry={() => setReload(n => n + 1)} /> : loading ? <div className="job-teaser-grid" aria-busy="true" aria-label="Đang tải việc làm">{[0,1,2].map(i => <div className="job-teaser skeleton-card" key={i}><span className="skeleton-line" /><span className="skeleton-line short" /><span className="skeleton-line" /></div>)}</div> : jobs.length ? <div className="job-teaser-grid">{jobs.map(job => <Link prefetch={false} className="job-teaser" key={job.id} href={`/candidate/jobs/${job.id}`}><span className="job-teaser-icon"><BriefcaseBusiness size={22} /></span><div><h3>{job.title}</h3><p>{job.ownerName}</p></div><span className="job-teaser-meta"><MapPin size={14} />{job.location || "Xem chi tiết"}</span><ArrowRight className="job-teaser-arrow" size={17} /></Link>)}</div> : <div className="home-empty"><BriefcaseBusiness size={26} /><h3>Cơ hội mới sẽ sớm có mặt</h3><p>Trong lúc chờ, hãy chuẩn bị hồ sơ để sẵn sàng ứng tuyển.</p><Link className="text-link" href="/candidate/profile/cvs">Chuẩn bị CV <ArrowRight size={16} /></Link></div>}
  </section>;
}
