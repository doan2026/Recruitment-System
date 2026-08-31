"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../../../../../components/ui";
import { ApiClientError, toUserMessage } from "../../../../../lib/apiClient";
import { getApplicationDetail, sendApplicationOffer, type CandidateApplication } from "../../../../../lib/person2Api";

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

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
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
  }, [applicationId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application || submitting) return;
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
    const expiresInstant = new Date(expiresAt);
    if (Number.isNaN(expiresInstant.getTime()) || expiresInstant.getTime() <= Date.now()) {
      setFormError("Hạn phản hồi phải ở tương lai.");
      return;
    }
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
      setSubmitError(toUserMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main><LoadingState label="Đang tải hồ sơ để soạn Offer" /></main>;
  if (loadError || !application) return <main><ErrorState message={loadError || "Không tìm thấy hồ sơ ứng tuyển."} /></main>;

  return (
    <main>
      <PageHeader eyebrow="RECRUITER · OFFER" title="Soạn Offer" description="Offer là lệnh riêng; không dùng endpoint đổi trạng thái để chuyển INTERVIEW thành OFFER." action={<Link className="btn" href={`/recruiter/jobs/${application.jobId}`}>Về pipeline</Link>} />
      {submitted ? (
        <section className="panel">
          <EmptyState title="Đã gửi Offer" description="Application đã chuyển sang OFFER bằng response authoritative từ backend." />
          <div className="btn-group"><StatusBadge tone="success">Version {application.version}</StatusBadge><Link className="btn btn-primary" href={`/recruiter/jobs/${application.jobId}`}>Xem pipeline</Link></div>
        </section>
      ) : (
        <form className="panel form-stack" onSubmit={submit} noValidate>
          <div className="section-head row-between"><div><h2>{application.candidateName}</h2><p className="help">{application.jobTitle}</p></div><StatusBadge tone={application.status === "INTERVIEW" ? "success" : "warning"}>{application.status}</StatusBadge></div>
          <div className="form-grid">
            <div className="field"><label className="label" htmlFor="offer-salary">Mức lương</label><input id="offer-salary" className="input" type="number" min="0.01" step="0.01" value={salary} onChange={(event) => setSalary(event.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="offer-start-date">Ngày bắt đầu</label><input id="offer-start-date" className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="offer-position">Vị trí</label><input id="offer-position" className="input" maxLength={200} value={position} onChange={(event) => setPosition(event.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="offer-expires">Hạn phản hồi</label><input id="offer-expires" className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div>
            <div className="field span-2"><label className="label" htmlFor="offer-note">Ghi chú</label><textarea id="offer-note" className="textarea resize-none" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
          </div>
          {formError ? <p className="form-error" role="alert">{formError}</p> : null}
          {submitError ? <p className="notice notice-danger" role="alert"><strong>Chưa gửi được Offer.</strong> {submitError}</p> : null}
          <div className="btn-group"><button className="btn btn-primary" type="submit" disabled={submitting || application.status !== "INTERVIEW"} aria-busy={submitting}>{submitting ? "Đang gửi Offer…" : "Gửi Offer"}</button><Link className="btn" href={`/recruiter/jobs/${application.jobId}`}>Hủy</Link></div>
        </form>
      )}
    </main>
  );
}
