"use client";

import { FormEvent, useState } from "react";
import { applicationCooldownView } from "../lib/applicationCooldown";
import { toUserMessage } from "../lib/apiClient";
import { isDemoPerson2Api, submitCandidateApplication } from "../lib/person2Api";

export function ApplyForm({ jobId }: { jobId: string }) {
  const [cvId, setCvId] = useState(isDemoPerson2Api ? "cv-frontend-01" : "");
  const [coverLetter, setCoverLetter] = useState("Tôi có kinh nghiệm phù hợp với yêu cầu vị trí. Mong được vào vòng tiếp theo.");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [responseError, setResponseError] = useState<unknown>(null);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitted) return;
    if (!cvId.trim()) {
      setResponseError(null);
      setMessage("Vui lòng chọn hoặc nhập mã CV đang hoạt động.");
      return;
    }
    setPending(true);
    setResponseError(null);
    setMessage("");
    try {
      const response = await submitCandidateApplication({
        jobId,
        cvId: cvId.trim(),
        coverLetter,
        source: "SEARCH",
      });
      setSubmitted(true);
      setMessage(`Đã gửi hồ sơ ứng tuyển. Trạng thái hiện tại: ${response.data.status}.`);
    } catch (reason: unknown) {
      setResponseError(reason);
    } finally {
      setPending(false);
    }
  }

  const cooldown = applicationCooldownView(responseError);

  return (
    <form className="card form-stack" id="apply" noValidate onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="apply-cv">CV dùng để ứng tuyển</label>
        {isDemoPerson2Api ? (
          <select id="apply-cv" className="select" value={cvId} disabled={pending || submitted} onChange={(event) => setCvId(event.target.value)}>
            <option value="cv-frontend-01">CV Frontend Senior</option>
            <option value="cv-frontend-02">CV Frontend Junior</option>
          </select>
        ) : (
          <input id="apply-cv" className="input" value={cvId} disabled={pending || submitted} placeholder="UUID của CV active" aria-describedby="apply-cv-help" onChange={(event) => setCvId(event.target.value)} />
        )}
        {!isDemoPerson2Api ? <span id="apply-cv-help" className="help">CV được quản lý ở Profile Service; form không lưu mã này ngoài React state.</span> : null}
      </div>
      <div className="field">
        <label className="label" htmlFor="apply-note">Thư ứng tuyển (tùy chọn)</label>
        <textarea id="apply-note" className="textarea resize-none" rows={4} maxLength={2000} value={coverLetter} disabled={pending || submitted} onChange={(event) => setCoverLetter(event.target.value)} />
        <span className="help">Tối đa 2.000 ký tự.</span>
      </div>
      <div className="btn-group">
        <button className="btn btn-primary" type="submit" disabled={pending || submitted || cooldown !== null} aria-busy={pending}>
          {pending ? "Đang gửi…" : submitted ? "Đã ứng tuyển" : "Gửi ứng tuyển"}
        </button>
      </div>
      {message ? <p className={submitted ? "notice notice-success" : "form-error"} role="status">{message}</p> : null}
      {cooldown ? (
        <section className="notice notice-warning" role="alert">
          <strong>{cooldown.title}</strong>
          <p>{cooldown.description}</p>
          <time dateTime={cooldown.eligibleAt}>Có thể nộp lại: {cooldown.eligibleAtLabel}</time>
        </section>
      ) : null}
      {responseError && !cooldown ? <p className="notice notice-danger" role="alert"><strong>Chưa gửi được hồ sơ.</strong> {toUserMessage(responseError)}</p> : null}
    </form>
  );
}
