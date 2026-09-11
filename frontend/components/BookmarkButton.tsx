"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, toUserMessage } from "../lib/apiClient";
import { getCandidateBookmarks, isDemoPerson2Api, removeCandidateBookmark, saveCandidateBookmark } from "../lib/person2Api";
import { useCurrentAccount } from "./SessionGate";

export function BookmarkButton({ jobId }: { jobId: string }) {
  const account = useCurrentAccount();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const locked = useRef(false);
  useEffect(() => {
    if (!isDemoPerson2Api && account?.role !== "CANDIDATE") { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    getCandidateBookmarks(controller.signal)
      .then((result) => { if (!controller.signal.aborted) setSaved(result.data.some((item) => item.jobId === jobId)); })
      .catch((reason) => { if (!controller.signal.aborted) setError(toUserMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [jobId, account?.id, account?.role, reload]);
  if (!isDemoPerson2Api && account?.role !== "CANDIDATE") return !account
    ? <Link className="btn" href={`/login?returnTo=/candidate/jobs/${jobId}`}>Đăng nhập để lưu việc</Link>
    : null;
  async function toggle() {
    if (locked.current || loading) return;
    locked.current = true; setPending(true); setError("");
    try {
      if (saved) await removeCandidateBookmark(jobId);
      else await saveCandidateBookmark(jobId);
      setSaved(!saved);
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 409) {
        // Duplicate or concurrent changes: read canonical state, never toggle blindly.
        setReload((value) => value + 1);
      } else setError(toUserMessage(reason));
    } finally { locked.current = false; setPending(false); }
  }
  return <div className="stack">
    <button className="btn" type="button" aria-pressed={saved} disabled={loading || pending || !!error} aria-busy={loading || pending} onClick={() => void toggle()}>
      {loading ? "Đang kiểm tra đã lưu…" : pending ? "Đang cập nhật…" : saved ? "Bỏ lưu việc làm" : "Lưu việc làm"}
    </button>
    {error ? <div className="notice notice-danger" role="alert">{error} <button className="btn" type="button" onClick={() => setReload((value) => value + 1)}>Tải lại trạng thái</button></div> : null}
    {!error && !loading ? <span className="help" role="status">{saved ? "Việc làm đã nằm trong danh sách đã lưu." : ""}</span> : null}
  </div>;
}
