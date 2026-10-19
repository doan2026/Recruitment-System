"use client";

import { jobTypeLabel } from "@/lib/recruitmentLabels";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import { bookmarkCardView } from "../../../lib/applicationDegradedStates";
import { getCandidateBookmarks, removeCandidateBookmark, type CandidateBookmark } from "../../../lib/person2Api";

export default function CandidateBookmarksPage() {
  const [bookmarks, setBookmarks] = useState<CandidateBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function remove(jobId: string) {
    if (removing) return;
    setRemoving(jobId); setError(""); setStatus("");
    try {
      await removeCandidateBookmark(jobId);
      setBookmarks((items) => items.filter((item) => item.jobId !== jobId));
      setStatus("Đã bỏ lưu việc làm.");
    } catch (reason) { setError(toUserMessage(reason)); }
    finally { setRemoving(null); }
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getCandidateBookmarks(controller.signal)
      .then((response) => {
        if (active) setBookmarks(response.data);
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
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
  }, [reloadKey]);

  return (
    <main>
      <PageHeader
        eyebrow="CƠ HỘI CỦA BẠN"
        title="Việc làm đã lưu"
        description="Lưu các cơ hội bạn quan tâm để dễ dàng xem lại và ứng tuyển. Tin đã lưu vẫn được giữ khi nội dung tạm thời chưa truy cập được."
        action={<Link className="btn" href="/candidate/jobs">Tìm thêm việc</Link>}
      />
      {error ? <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {status ? <p className="notice notice-success" role="status">{status}</p> : null}
      {loading ? <LoadingState label="Đang tải việc làm đã lưu" /> : null}
      {!loading && !error && bookmarks.length === 0 ? (
        <EmptyState title="Chưa lưu việc làm" description="Những tin bạn đánh dấu sẽ xuất hiện ở đây." href="/candidate/jobs" action="Khám phá việc làm" />
      ) : null}
      <section className="stack" aria-label="Danh sách việc làm đã lưu">
        {bookmarks.map((bookmark) => {
          const view = bookmarkCardView(bookmark);
          const canOpen = view.available && bookmark.job?.exists;
          return (
            <article className="panel" key={bookmark.id}>
              <div className="section-head">
                <div>
                  <p className="eyebrow">LƯU NGÀY {new Date(bookmark.createdAt).toLocaleDateString("vi-VN")}</p>
                  <h2>{view.title}</h2>
                </div>
                <StatusBadge tone={view.available ? (canOpen ? "success" : "warning") : "neutral"}>
                  {view.available ? (canOpen ? "Đang khả dụng" : "Đã đóng") : "Tạm gián đoạn"}
                </StatusBadge>
              </div>
              <p className="help">{view.description}</p>
              {bookmark.job ? (
                <div className="chip-list" aria-label="Thông tin việc làm">
                  {bookmark.job.location ? <span className="chip">{bookmark.job.location}</span> : null}
                  {bookmark.job.jobType ? <span className="chip">{jobTypeLabel(bookmark.job.jobType)}</span> : null}
                  {(bookmark.job.skills ?? []).slice(0, 4).map((skill) => <span className="chip" key={skill}>{skill}</span>)}
                </div>
              ) : null}
              <div className="btn-group">
                <button className="btn" type="button" disabled={removing !== null} aria-busy={removing === bookmark.jobId} onClick={() => void remove(bookmark.jobId)}>{removing === bookmark.jobId ? "Đang bỏ lưu…" : "Bỏ lưu"}</button>
                {canOpen ? <Link className="btn btn-primary" href={`/candidate/jobs/${bookmark.jobId}`}>Xem việc làm</Link> : null}
                {!view.available ? <button className="btn" type="button" onClick={() => setReloadKey((value) => value + 1)}>Thử đồng bộ lại</button> : null}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
