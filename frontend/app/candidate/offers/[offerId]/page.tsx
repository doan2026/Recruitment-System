"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../../../components/ui";
import { toUserMessage } from "../../../../lib/apiClient";
import { getOffer, Offer } from "../../../../lib/person2Api";

type Phase = "accept" | "decline" | "request";

export default function CandidateOfferResponsePage({ params }: { params: { offerId: string } }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let running = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getOffer(params.offerId, controller.signal)
      .then((response) => {
        if (running) setOffer(response.data || null);
      })
      .catch((reason: unknown) => {
        if (running) setLoadError(toUserMessage(reason));
      })
      .finally(() => {
        if (running) setLoading(false);
      });
    return () => {
      running = false;
      controller.abort();
    };
  }, [params.offerId, reloadKey]);

  function submit(action: Phase) {
    setPhase(action);
    setMessage(
      `Gửi phản hồi ${action.toUpperCase()} cho offer ${params.offerId}. ` +
        "Frontend giữ version trước khi gọi endpoint actual response.",
    );
  }

  if (loading) {
    return <main><LoadingState label="Đang tải offer" /></main>;
  }

  if (loadError) {
    return <main><ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} /></main>;
  }

  if (!offer) {
    return (
      <main>
        <p>Không tìm thấy offer.</p>
        <Link className="btn" href="/candidate/applications">
          Về hồ sơ ứng tuyển
        </Link>
      </main>
    );
  }

  return (
    <main>
      <h1 className="page-title">Phản hồi Offer</h1>
      <section className="grid-2">
        <section className="panel">
          <h2>Thông tin Offer</h2>
          <p className="help">Candidate nhận offer từ notification và chỉ gọi theo offerId từ message.</p>
          <div className="row-wrap">
            <span className="badge">offerVersion: {offer.offerVersion}</span>
            <span className="badge">applicationVersion: {offer.applicationVersion}</span>
            <span className="badge">expire: {new Date(offer.expiresAt).toLocaleDateString("vi-VN")}</span>
          </div>
          <p>Công việc: {offer.jobTitle}</p>
          <p>Ứng viên: {offer.candidateName}</p>
          <p>Gói lương: {offer.salary}</p>
          {offer.fileUrl ? <p>File đính kèm: {offer.fileId}</p> : null}
          <div className="btn-group" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => submit("accept")}>Chấp nhận</button>
            <button className="btn btn-danger" onClick={() => submit("decline")}>Từ chối</button>
            <button className="btn" onClick={() => submit("request")}>
              Yêu cầu gia hạn
            </button>
          </div>
          {phase ? <p className="notice">{message}</p> : null}
          <p className="status-line">Checklist: tách riêng các lỗi OFFER_EXPIRED, OFFER_ALREADY_RESPONDED, OFFER_CHANGED_CONCURRENTLY, APPLICATION_CHANGED_CONCURRENTLY.</p>
        </section>
        <section className="panel">
          <h2>Gợi ý</h2>
          <p className="help">Nếu `details.eligibleAt` đi kèm thì ưu tiên hiển thị ngày cụ thể thay vì lỗi chung.</p>
          <p className="help">Offer response luôn phải gửi `expectedOfferVersion` + `expectedApplicationVersion`.</p>
          <Link className="btn" href="/candidate/jobs">
            Tìm việc mới
          </Link>
        </section>
      </section>
    </main>
  );
}
