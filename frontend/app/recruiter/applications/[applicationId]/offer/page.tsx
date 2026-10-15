"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../../../lib/apiClient";
import { OFFER_ATTACHMENT_SUPPORT } from "../../../../../lib/offerAttachment";
import { getApplicationDetail, sendApplicationOffer, type CandidateApplication } from "../../../../../lib/person2Api";

// Exact 409 codes POST /applications/:id/offer can return when the page is stale.
const OFFER_STALE_MESSAGES: Partial<Record<string, string>> = {
  APPLICATION_CHANGED_CONCURRENTLY: "Hồ sơ vừa thay đổi. Đã tải trạng thái mới và giữ bản Offer bạn nhập; hãy kiểm tra trước khi chủ động gửi lại.",
  APPLICATION_NOT_ELIGIBLE_FOR_OFFER: "Hồ sơ không còn ở bước phỏng vấn nên không thể gửi Offer. Đã tải trạng thái mới nhất.",
  OFFER_ALREADY_EXISTS: "Hồ sơ này đã có Offer (có thể do đồng nghiệp vừa gửi). Đã tải trạng thái mới nhất.",
};

export default function RecruiterSendOfferPage() {
  const params = useParams<{ applicationId: string }>();
  const applicationId = params.applicationId;
  const [application, setApplication] = useState<CandidateApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [position, setPosition] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [formError, setFormError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getApplicationDetail(applicationId, controller.signal)
      .then((response) => {
        if (active) {
          setApplication(response.data);
          setPosition(response.data.jobTitle);
        }
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) setLoadError(toUserMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [applicationId, reloadKey]);

  async function submit(event?: FormEvent<HTMLFormElement>, confirmed = false) {
    event?.preventDefault();
    if (!application || submitting || submitted) return;
    const numericSalary = Number(salary);
    if (application.status !== "INTERVIEW") {
      setFormError("Chỉ hồ sơ đang ở INTERVIEW mới có thể nhận Offer.");
      return;
    }
    if (application.version === null) {
      setFormError("Thiếu phiên bản hồ sơ. Hãy tải lại trang.");
      return;
    }
    if (!Number.isFinite(numericSalary) || numericSalary <= 0 || !startDate || !position.trim() || !expiresAt) {
      setFormError("Nhập đủ mức lương, ngày bắt đầu, vị trí và hạn phản hồi hợp lệ.");
      return;
    }
    if (!/^\d{1,15}(?:\.\d{1,2})?$/.test(salary.trim()) || startDate < new Date().toISOString().slice(0, 10)) {
      setFormError("Lương có tối đa 2 chữ số thập phân; ngày bắt đầu không được ở quá khứ.");
      document.getElementById("offer-salary")?.focus();
      return;
    }
    const expiresInstant = new Date(expiresAt);
    if (Number.isNaN(expiresInstant.getTime()) || expiresInstant.getTime() <= Date.now()) {
      setFormError("Hạn phản hồi phải ở tương lai.");
      return;
    }
    if (!confirmed) { setConfirmSend(true); return; }
    setSubmitting(true);
    setFormError("");
    setSubmitError("");
    try {
      const response = await sendApplicationOffer(application.id, {
        salary: numericSalary,
        startDate,
        position,
        note,
        expiresAt: expiresInstant.toISOString(),
        applicationVersion: application.version,
      });
      setApplication((current) => current ? { ...current, status: response.data.applicationStatus, version: response.data.applicationVersion } : current);
      setSubmitted(true);
    } catch (reason: unknown) {
      const staleMessage = reason instanceof ApiClientError ? OFFER_STALE_MESSAGES[reason.code] : undefined;
      if (staleMessage) {
        try {
          const latest = await getApplicationDetail(application.id);
          setApplication(latest.data);
          setSubmitError(staleMessage);
        } catch (reloadError: unknown) { setSubmitError(toUserMessage(reloadError)); }
      } else setSubmitError(toUserMessage(reason));
    } finally {
      setSubmitting(false);
      setConfirmSend(false);
    }
  }

  if (loading) return <main><LoadingState label="Đang tải hồ sơ để soạn Offer" /></main>;
  if (loadError || !application) return <main><ErrorState message={loadError || "Không tìm thấy hồ sơ ứng tuyển."} onRetry={() => setReloadKey((value) => value + 1)} /></main>;

  return (
    <main>
      <ConfirmationDialog open={confirmSend} title="Gửi Offer cho ứng viên?" description={`Thư mời cho vị trí “${position}” với mức lương ${salary} sẽ được gửi và hồ sơ chuyển sang bước chờ phản hồi.`} confirmLabel="Gửi Offer" pending={submitting} onConfirm={() => { void submit(undefined, true); }} onCancel={() => setConfirmSend(false)} />
      <PageHeader eyebrow="RECRUITER · OFFER" title="Soạn Offer" description="Gửi thư mời sau vòng phỏng vấn và chờ ứng viên phản hồi." action={<Link className="btn" href={`/recruiter/jobs/${application.jobId}`}>Về pipeline</Link>} />
      {submitted ? (
        <section className="panel">
          <EmptyState title="Đã gửi Offer" description="Hồ sơ đã chuyển sang bước chờ ứng viên phản hồi thư mời." />
          <div className="btn-group"><StatusBadge tone="success">Đang chờ phản hồi</StatusBadge><Link className="btn btn-primary" href={`/recruiter/jobs/${application.jobId}`}>Xem pipeline</Link></div>
        </section>
      ) : (
        <form className="panel form-stack" onSubmit={submit} noValidate>
          <div className="section-head row-between"><div><h2>{application.candidateName}</h2><p className="help">{application.jobTitle}</p></div><StatusBadge tone={application.status === "INTERVIEW" ? "success" : "warning"}>{application.status}</StatusBadge></div>
          <div className="form-grid">
            <div className="field"><label className="label" htmlFor="offer-salary">Mức lương</label><input id="offer-salary" className="input" type="number" min="0.01" step="0.01" disabled={submitting} value={salary} onChange={(event) => setSalary(event.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="offer-start-date">Ngày bắt đầu</label><input id="offer-start-date" className="input" type="date" disabled={submitting} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="offer-position">Vị trí</label><input id="offer-position" className="input" maxLength={200} disabled={submitting} value={position} onChange={(event) => setPosition(event.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="offer-expires">Hạn phản hồi</label><input id="offer-expires" className="input" type="datetime-local" disabled={submitting} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div>
            <div className="field span-2"><label className="label" htmlFor="offer-note">Ghi chú</label><textarea id="offer-note" className="textarea resize-none" maxLength={2000} disabled={submitting} value={note} onChange={(event) => setNote(event.target.value)} /></div>
            <div className="field span-2">
              <label className="label" htmlFor="offer-file">File Offer (tùy chọn)</label>
              <input id="offer-file" className="input" type="file" accept="application/pdf,.pdf" disabled aria-describedby="offer-file-support" />
              <div id="offer-file-support" className="notice notice-warning" role="status">
                <strong>{OFFER_ATTACHMENT_SUPPORT.title}.</strong> {OFFER_ATTACHMENT_SUPPORT.description}
              </div>
            </div>
          </div>
          {formError ? <p className="form-error" role="alert">{formError}</p> : null}
          {submitError ? <p className="notice notice-danger" role="alert"><strong>Chưa gửi được Offer.</strong> {submitError}</p> : null}
          <div className="btn-group"><button className="btn btn-primary" type="submit" disabled={submitting || application.status !== "INTERVIEW"} aria-busy={submitting}>{submitting ? "Đang gửi Offer…" : "Gửi Offer"}</button><Link className="btn" href={`/recruiter/jobs/${application.jobId}`}>Hủy</Link></div>
        </form>
      )}
    </main>
  );
}
