"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getActiveCandidateCvs, type ActiveCandidateCv } from "../../../../lib/person2Api";
import { toUserMessage } from "../../../../lib/apiClient";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../../../components/ui";

export default function CandidateCvsPage() {
  const [cvs, setCvs] = useState<ActiveCandidateCv[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    getActiveCandidateCvs(controller.signal)
      .then((response) => { if (!controller.signal.aborted) setCvs(response.data); })
      .catch((reason) => { if (!controller.signal.aborted) setError(toUserMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  return <main>
    <PageHeader eyebrow="CANDIDATE · CV" title="CV của tôi" description="CV còn hoạt động để chọn khi ứng tuyển; dữ liệu được đọc từ Profile Service." action={<Link className="btn" href="/candidate/jobs">Tìm việc phù hợp</Link>} />
    {loading ? <LoadingState label="Đang tải CV" /> : error ? <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /> : !cvs.length
      ? <EmptyState title="Chưa có CV hoạt động" description="Bạn cần tạo hoặc tải CV lên qua chức năng Hồ sơ/CV của nhóm phụ trách Profile trước khi ứng tuyển. Phần này hiện chỉ đọc và chọn CV, chưa có chức năng tạo/tải CV." />
      : <section className="stack" aria-label="CV còn hoạt động">{cvs.map((cv) => <article className="card" key={cv.id}>
        <h2>{cv.title}</h2><p>{cv.type === "ONLINE" ? "CV trực tuyến" : "CV tải lên"}{cv.isDefault ? " · Mặc định" : ""}</p>
        <p className="help">Tạo ngày {new Date(cv.createdAt).toLocaleDateString("vi-VN")}</p>
        <Link className="btn" href="/candidate/jobs">Chọn việc để ứng tuyển với CV này</Link>
      </article>)}</section>}
    <p className="help">Không thay đổi quyền khám phá ứng viên hoặc nội dung CV tại màn hình này.</p>
  </main>;

}
