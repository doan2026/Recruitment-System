"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ApplyForm } from "@/components/ApplyForm";
import { useCurrentAccount } from "@/components/SessionGate";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../../lib/apiClient";
import { getPublicJob, getRecommendationsForCandidate, isDemoPerson2Api, type Job, type JobRecommendation } from "../../../../lib/person2Api";
import { createConversation } from "../../../../lib/chatApi";
import { useRouter } from "next/navigation";

const SOURCES = ["SEARCH", "AI_RECOMMENDATION", "COMPANY_PAGE", "SHARED_LINK", "OTHER"] as const;
type ApplicationSource = typeof SOURCES[number];

function formatSalary(value: number, currency: string): string {
  return `${value.toLocaleString("vi-VN")} ${currency}`;
}

export default function CandidateJobDetailPage({ params, searchParams }: {
  params: { jobId: string };
  searchParams: { source?: string };
}) {
  const router = useRouter();
  const account = useCurrentAccount();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [recommendations, setRecommendations] = useState<JobRecommendation[]>([]);
  const [recommendationError, setRecommendationError] = useState("");
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [chatError, setChatError] = useState("");
  const canRecommend = isDemoPerson2Api || account?.role === "CANDIDATE";
  const source = SOURCES.includes(searchParams.source as ApplicationSource)
    ? searchParams.source as ApplicationSource
    : "SEARCH";

  async function handleStartChat() {
    if (!job?.createdBy || chatting || account?.role !== "CANDIDATE") return;
    setChatError("");
    setChatting(true);
    try {
      const response = await createConversation(`Chat với ${job.ownerName}`, [job.createdBy], false);
      router.push(`/messages?chat=${response.data.id}`);
    } catch (e) {
      setChatError("Không thể mở cuộc trò chuyện. " + toUserMessage(e));
    } finally {
      setChatting(false);
    }
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getPublicJob(params.jobId, controller.signal)
      .then((response) => { if (active) setJob(response.data); })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) setError(toUserMessage(reason));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [params.jobId, reloadKey]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!canRecommend) { setRecommendations([]); setRecommendationLoading(false); return; }
    setRecommendationLoading(true);
    setRecommendationError("");
    getRecommendationsForCandidate({ limit: 3 }, controller.signal)
      .then((response) => { if (active) setRecommendations(response.data.filter((item) => item.id !== params.jobId)); })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) setRecommendationError(toUserMessage(reason));
      })
      .finally(() => { if (active) setRecommendationLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [canRecommend, params.jobId]);

  if (loading) return <main><LoadingState label="Đang tải việc làm" /></main>;
  if (error) return <main><ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} /><Link className="btn" href="/candidate/jobs">Quay về danh sách</Link></main>;
  if (!job) return <main><h1 className="page-title">Không tìm thấy việc làm</h1><Link className="btn" href="/candidate/jobs">Quay về danh sách</Link></main>;

  const canApply = job.status === "PUBLISHED" && job.deadline.slice(0, 10) >= new Date().toISOString().slice(0, 10);
  return (
    <main>
      <PageHeader title={job.title} description={`${job.location} · ${job.level}`} action={<Link className="btn" href="/candidate/jobs">Quay về danh sách</Link>} />
      <Link className="btn" href={`/reports?type=JOB&id=${encodeURIComponent(job.id)}`}>Báo cáo tin tuyển dụng</Link>
      <section className="grid-2">
        <section className="panel">
          <div className="section-head"><h2>Chi tiết công việc</h2><StatusBadge tone={canApply ? "success" : "warning"}>{job.status}</StatusBadge></div>
          <p>{job.description}</p>
          <div className="grid-2">
            <div className="stat"><strong>Lương</strong><p>{job.isNegotiable ? "Thỏa thuận" : `${formatSalary(job.salaryMin, job.currency)} – ${job.salaryMax === null ? "Chưa công bố" : formatSalary(job.salaryMax, job.currency)}`}</p></div>
            <div className="stat"><strong>Hình thức</strong><p>{({ FULLTIME: "Toàn thời gian", PARTTIME: "Bán thời gian", REMOTE: "Làm việc từ xa", INTERNSHIP: "Thực tập" })[job.type]}</p></div>
          </div>
          <h3>Yêu cầu ứng viên</h3>
          <ul>{job.requirements.map((item, index) => <li key={index}>{item}</li>)}</ul>
          <h3>Quyền lợi</h3>
          <ul>{job.benefits.map((item, index) => <li key={index}>{item}</li>)}</ul>
          <p><strong>Kỹ năng:</strong> {job.skills.join(", ")}</p>
          <p><strong>Hạn nộp:</strong> <time dateTime={job.deadline.slice(0, 10)}>{job.deadline.slice(0, 10).split("-").reverse().join("/")}</time></p>
          <div className="btn-group">
            <Link className="btn" href={`/companies/${job.companyId}`}>Xem công ty</Link>
            {job.createdBy && account?.role === "CANDIDATE" && (
              <button className="btn" type="button" onClick={handleStartChat} disabled={chatting} aria-busy={chatting}>
                {chatting ? "Đang tạo..." : "Chat ngay"}
              </button>
            )}
            <BookmarkButton jobId={job.id} />
          </div>
          {chatError ? <p className="notice notice-danger" role="alert">{chatError}</p> : null}
        </section>
        <section className="panel">
          <h2>Ứng tuyển</h2>
          {canApply ? <ApplyForm jobId={job.id} source={source} /> : <p className="notice">Tin này hiện không nhận thêm hồ sơ. Bạn vẫn có thể xem nội dung và tìm việc khác.</p>}
        </section>
      </section>
      {canRecommend ? (
        <section className="panel">
          <h2>Việc làm gợi ý khác</h2>
          {recommendationLoading ? <LoadingState label="Đang tải gợi ý" /> : null}
          {recommendationError ? <p className="notice notice-warning">Gợi ý tạm thời chưa sẵn sàng. Bạn vẫn có thể đọc và ứng tuyển tin này.</p> : null}
          <div className="grid-2">{recommendations.map((item) => (
            <Link key={item.id} className="card" href={`/candidate/jobs/${item.id}?source=${item.source === "AI" ? "AI_RECOMMENDATION" : "SEARCH"}`}><strong>{item.title}</strong></Link>
          ))}</div>
          <Link className="btn" href="/candidate/jobs#suitable-jobs">Xem thêm gợi ý</Link>
        </section>
      ) : null}
    </main>
  );
}
