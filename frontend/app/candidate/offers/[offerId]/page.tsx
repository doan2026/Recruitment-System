"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState, StatusBadge } from "../../../../components/ui";
import { toUserMessage } from "../../../../lib/apiClient";
import { offerResponseRecoveryView } from "../../../../lib/offerResponseRecovery";
import { getOffer, Offer, respondToApplicationOffer } from "../../../../lib/person2Api";

type Phase = "ACCEPTED" | "DECLINED";

export default function CandidateOfferResponsePage({ params }: { params: { offerId: string } }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineReasonError, setDeclineReasonError] = useState("");
  const [responseError, setResponseError] = useState<unknown>(null);
  const [successMessage, setSuccessMessage] = useState("");
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

  async function submit(decision: Phase) {
    if (!offer || phase) return;
    const normalizedReason = declineReason.trim();
    if (decision === "DECLINED" && !normalizedReason) {
      setDeclineReasonError("Vui lòng nhập lý do từ chối Offer.");
      return;
    }
    setPhase(decision);
    setDeclineReasonError("");
    setResponseError(null);
    setSuccessMessage("");
    try {
      const response = await respondToApplicationOffer(params.offerId, {
        decision,
        declineReason: decision === "DECLINED" ? normalizedReason : undefined,
        offerVersion: offer.offerVersion,
        applicationVersion: offer.applicationVersion,
      });
      setOffer((current) => current ? {
        ...current,
        status: response.data.status === "SENT" ? "PENDING_CANDIDATE_RESPONSE" : response.data.status,
        offerVersion: response.data.version,
        applicationVersion: response.data.applicationVersion,
      } : current);
      setSuccessMessage(decision === "ACCEPTED" ? "Đã chấp nhận Offer." : "Đã từ chối Offer.");
    } catch (reason: unknown) {
      setResponseError(reason);
    } finally {
      setPhase(null);
    }
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

  const recoveryView = offerResponseRecoveryView(responseError);
  const canRespond = offer.status === "PENDING_CANDIDATE_RESPONSE";

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
            <StatusBadge tone={canRespond ? "warning" : offer.status === "ACCEPTED" ? "success" : "danger"}>{offer.status}</StatusBadge>
          </div>
          <p>Công việc: {offer.jobTitle}</p>
          <p>Ứng viên: {offer.candidateName}</p>
          <p>Gói lương: {offer.salary}</p>
          {offer.fileUrl ? <p>File đính kèm: {offer.fileId}</p> : null}
          {canRespond ? (
            <div className="field" style={{ marginTop: 12 }}>
              <label className="label" htmlFor="offer-decline-reason">Lý do nếu từ chối</label>
              <textarea id="offer-decline-reason" className="textarea resize-none" maxLength={2000} value={declineReason} aria-describedby={declineReasonError ? "offer-decline-error" : "offer-decline-help"} onChange={(event) => { setDeclineReason(event.target.value); setDeclineReasonError(""); }} />
              {declineReasonError ? <span id="offer-decline-error" className="form-error">{declineReasonError}</span> : <span id="offer-decline-help" className="help">Bắt buộc khi từ chối, tối đa 2.000 ký tự.</span>}
              <div className="btn-group">
                <button className="btn btn-primary" type="button" disabled={phase !== null} aria-busy={phase === "ACCEPTED"} onClick={() => { void submit("ACCEPTED"); }}>{phase === "ACCEPTED" ? "Đang chấp nhận…" : "Chấp nhận"}</button>
                <button className="btn btn-danger" type="button" disabled={phase !== null} aria-busy={phase === "DECLINED"} onClick={() => { void submit("DECLINED"); }}>{phase === "DECLINED" ? "Đang từ chối…" : "Từ chối"}</button>
              </div>
            </div>
          ) : <p className="notice">Offer đã có quyết định và không thể phản hồi lần nữa.</p>}
          {successMessage ? <p className="notice notice-success" role="status">{successMessage}</p> : null}
          {responseError && recoveryView ? (
            <section className="notice notice-warning" role="alert">
              <strong>{recoveryView.title}</strong>
              <p>{recoveryView.description}</p>
              {recoveryView.action.kind === "LINK" ? <Link className="btn btn-secondary" href={recoveryView.action.href}>{recoveryView.action.label}</Link> : <button className="btn btn-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>{recoveryView.action.label}</button>}
            </section>
          ) : null}
          {responseError && !recoveryView ? <ErrorState message={toUserMessage(responseError)} /> : null}
        </section>
        <section className="panel">
          <h2>Gợi ý</h2>
          <p className="help">Mỗi quyết định gửi đồng thời hai phiên bản độc lập. Khi một phiên bản thay đổi, CareerHub không tự gửi lại trên dữ liệu cũ.</p>
          <Link className="btn" href="/candidate/jobs">
            Tìm việc mới
          </Link>
        </section>
      </section>
    </main>
  );
}
