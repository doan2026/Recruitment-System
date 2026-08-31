"use client";

import { useState } from "react";
import { ApiClientError, toUserMessage } from "../lib/apiClient";
import { resolveFreshCvDownload } from "../lib/recruiterCvAccess";
import { createRecruiterCvDownload, getRecruiterApplicationCv, type RecruiterApplicationCv } from "../lib/person2Api";
import { StatusBadge } from "./ui";

export function RecruiterCvAccess({ applicationId }: { applicationId: string }) {
  const [metadata, setMetadata] = useState<RecruiterApplicationCv | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function openCv() {
    if (pending) return;
    const popup = window.open("about:blank", "_blank", "popup");
    if (!popup) {
      setError("Trình duyệt đã chặn cửa sổ xem CV. Hãy cho phép popup rồi thử lại.");
      return;
    }
    popup.opener = null;
    setPending(true);
    setError("");
    setStatus("");
    try {
      const cv = await getRecruiterApplicationCv(applicationId);
      setMetadata(cv.data);
      const download = await resolveFreshCvDownload(async () => (
        await createRecruiterCvDownload(applicationId)
      ).data);
      popup.location.replace(download.url);
      setStatus(`CV đã mở bằng link mới, hết hạn lúc ${new Date(download.expiresAt).toLocaleTimeString("vi-VN")}.`);
    } catch (reason: unknown) {
      popup.close();
      setError(toUserMessage(reason));
      if (reason instanceof ApiClientError && reason.code === "CV_DOWNLOAD_EXPIRED") {
        setError("Link CV hết hạn quá nhanh. Hãy bấm mở lại để xin link mới.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cv-access">
      <div className="btn-group">
        <button className="btn" type="button" onClick={() => { void openCv(); }} disabled={pending} aria-busy={pending}>
          {pending ? "Đang xin link CV…" : "Xem CV"}
        </button>
        {metadata ? <StatusBadge tone={metadata.isDeleted ? "warning" : "neutral"}>{metadata.type} · {metadata.isDeleted ? "Revision lịch sử" : "Đang hoạt động"}</StatusBadge> : null}
      </div>
      {metadata ? <p className="help"><strong>{metadata.title}</strong> · Tạo ngày {new Date(metadata.createdAt).toLocaleDateString("vi-VN")}</p> : null}
      {status ? <p className="status-line" role="status">{status}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
