"use client";

import Link from "next/link";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { useEffect, useRef, useState } from "react";
import { ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../../lib/apiClient";
import { offerResponseRecoveryView } from "../../../../lib/offerResponseRecovery";
import { getOffer, Offer, respondToApplicationOffer } from "../../../../lib/person2Api";

type Phase = "ACCEPTED" | "DECLINED";

export default function CandidateOfferResponsePage({ params }: { params: { offerId: string } }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase | null>(null);
  const responseInFlight = useRef(false);
  const [confirmDecision, setConfirmDecision] = useState<Phase | null>(null);
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
    setResponseError(null);
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

  async function submit(decision: Phase, confirmed = false) {
    if (!offer || responseInFlight.current) return;
    const blockedCode = offer.status !== "PENDING_CANDIDATE_RESPONSE"
      ? "OFFER_ALREADY_RESPONDED"
      : offer.applicationStatus && offer.applicationStatus !== "OFFER"
        ? "APPLICATION_CHANGED_CONCURRENTLY"
        : !(Date.parse(offer.expiresAt) > Date.now())
          ? "OFFER_EXPIRED"
          : null;
    if (blockedCode) {
      setResponseError(new ApiClientError({ code: blockedCode, status: 409 }));
      setConfirmDecision(null);
      return;
    }
    const normalizedReason = declineReason.trim();
    if (decision === "DECLINED" && !normalizedReason) {
      setDeclineReasonError("Vui lòng nhập lý do từ chối Offer.");
      document.getElementById("offer-decline-reason")?.focus();
      return;
    }
    if (!confirmed) { setConfirmDecision(decision); return; }
    responseInFlight.current = true;
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
        applicationStatus: response.data.applicationStatus,
        responseNote: response.data.responseNote,
      } : current);
      setSuccessMessage(decision === "ACCEPTED" ? "Đã chấp nhận Offer." : "Đã từ chối Offer.");
    } catch (reason: unknown) {
      setResponseError(reason);
    } finally {
      responseInFlight.current = false;
      setPhase(null);
      setConfirmDecision(null);
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
  const canRespond = offer.status === "PENDING_CANDIDATE_RESPONSE"
    && (!offer.applicationStatus || offer.applicationStatus === "OFFER")
    && Date.parse(offer.expiresAt) > Date.now() && recoveryView === null;
  const attachmentUrl = offer.fileUrl && /^https?:\/\//i.test(offer.fileUrl) ? offer.fileUrl : null;

  return (
    <main>
      <h1 className="page-title">Phản hồi Offer</h1>
      <ConfirmationDialog open={confirmDecision !== null} title={confirmDecision === "ACCEPTED" ? "Chấp nhận Offer?" : "Từ chối Offer?"} description={`Quyết định cho vị trí “${offer.jobTitle}” sẽ được gửi tới nhà tuyển dụng và kết thúc bước phản hồi này.`} confirmLabel={confirmDecision === "ACCEPTED" ? "Chấp nhận Offer" : "Từ chối Offer"} pending={phase !== null} onConfirm={() => { if (confirmDecision) void submit(confirmDecision, true); }} onCancel={() => setConfirmDecision(null)} />
      <section className="grid-2">
        <section className="panel">
          <h2>Thông tin Offer</h2>
          <p className="help">Kiểm tra nội dung và hạn phản hồi trước khi đưa ra quyết định.</p>
          <div className="row-wrap">
            <span className="badge">Hạn phản hồi: {new Date(offer.expiresAt).toLocaleString("vi-VN")}</span>
            <StatusBadge tone={canRespond ? "warning" : offer.status === "ACCEPTED" ? "success" : "danger"}>{offer.status}</StatusBadge>
          </div>
          <p>Công việc: {offer.jobTitle}</p>
          {offer.startDate ? <p>Ngày bắt đầu: <time dateTime={offer.startDate}>{offer.startDate.split("-").reverse().join("/")}</time></p> : null}
          <p>Gói lương: {offer.salary}</p>
          {offer.note ? <p style={{ whiteSpace: "pre-wrap" }}>{offer.note}</p> : null}
          {offer.responseNote ? <p>Lý do phản hồi: {offer.responseNote}</p> : null}
          {attachmentUrl ? <a className="btn" href={attachmentUrl} target="_blank" rel="noreferrer">Xem file Offer</a> : null}
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
          ) : <p className="notice">Offer đã kết thúc, hết hạn hoặc cần được tải lại trước khi phản hồi.</p>}
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
          <p className="help">Nếu nhà tuyển dụng vừa cập nhật hồ sơ hoặc Offer, hãy tải nội dung mới trước khi quyết định.</p>
          <Link className="btn" href={`/candidate/applications/${offer.applicationId}`}>Xem hồ sơ ứng tuyển</Link>
          <Link className="btn" href="/candidate/jobs">
            Tìm việc mới
          </Link>
        </section>
      </section>
    </main>
  );
}
