"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Person1Gate } from "@/components/Person1Gate";
import { ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { requestApi } from "../../../../lib/apiClient";
import { person1Error, type CandidateCv } from "../../../../lib/person1Api";

function CvDetail({ cvId }: { cvId: string }) {
  const [cv, setCv] = useState<CandidateCv | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCv(null); setError(""); setActionError("");
    requestApi<CandidateCv>(`/profile/cvs/${encodeURIComponent(cvId)}`, { privateData: true, signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) setCv(r.data); })
      .catch(e => { if (!controller.signal.aborted) setError(person1Error(e)); });
    return () => controller.abort();
  }, [cvId, reload]);
  async function download() {
    if (pending || !cv) return;
    setPending(true); setActionError("");
    try {
      const r = await requestApi<{ url: string }>(`/profile/cvs/${encodeURIComponent(cvId)}/download-url`, {
        method: "POST", privateData: true, maxRetries: 0,
      });
      const url = new URL(r.data.url);
      if (url.protocol !== "https:") throw new Error("Liên kết tải không hợp lệ.");
      const link = document.createElement("a");
      link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click();
    } catch (e) { setActionError(person1Error(e)); }
    finally { setPending(false); }
  }
  return <main>
    <PageHeader eyebrow="HỒ SƠ · CV" title={cv?.title ?? "Chi tiết CV"} />
    {error ? <ErrorState message={error} onRetry={() => setReload(n => n + 1)} /> : !cv ? <LoadingState label="Đang tải CV" /> : <section className="card stack">
      <p>{cv.type === "ONLINE" ? "CV trực tuyến" : "CV tải lên"} · Phiên bản {cv.revisionNumber}</p>
      {cv.isDefault && <p>CV mặc định</p>}
      <div className="btn-group">
        <button className="btn btn-primary" disabled={pending} onClick={() => void download()}>{pending ? "Đang lấy liên kết…" : "Tải xuống PDF"}</button>
        {cv.type === "ONLINE" && <Link className="btn" href={`/candidate/profile/cvs/builder?id=${encodeURIComponent(cv.id)}`}>Chỉnh sửa CV</Link>}
      </div>
    </section>}
    {actionError && <p role="alert" className="notice notice-danger">{actionError}</p>}
    <Link className="btn" href="/candidate/profile/cvs">Danh sách CV</Link>
  </main>;
}

export default function CVDetailPage({ params }: { params: { cvId: string } }) {
  return <Person1Gate role="CANDIDATE"><CvDetail cvId={params.cvId} /></Person1Gate>;
}
