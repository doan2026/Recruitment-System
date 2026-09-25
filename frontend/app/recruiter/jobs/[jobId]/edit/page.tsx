"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "../../../../../components/ui";
import { ConfirmationDialog } from "../../../../../components/ConfirmationDialog";
import { ConflictRecoveryPanel } from "../../../../../components/ConflictRecoveryPanel";
import { ApiClientError, toUserMessage } from "../../../../../lib/apiClient";
import { prepareConflictSnapshot, type ConflictSnapshot } from "../../../../../lib/conflictRecovery";
import { JOB_CONFLICT_FIELDS } from "../../../../../lib/person2ConflictFields";
import {
  jobEditRequiresReview,
  normalizeRecruiterJobForm,
  validateRecruiterJobForm,
  type RecruiterJobFormValues,
} from "../../../../../lib/jobForm";
import {
  getRecruiterJob,
  submitJobForApproval,
  updateRecruiterJob,
  type Job,
} from "../../../../../lib/person2Api";

function toDraft(job: Job): RecruiterJobFormValues {
  return {
    title: job.title,
    location: job.location,
    jobType: job.type === "FULLTIME" ? "FULL_TIME" : job.type === "PARTTIME" ? "PART_TIME" : job.type,
    currency: job.currency,
    deadline: job.deadline.slice(0, 10),
    isNegotiable: job.isNegotiable,
    salaryMin: job.isNegotiable ? "" : String(job.salaryMin),
    salaryMax: job.isNegotiable || job.salaryMax === null ? "" : String(job.salaryMax),
    experienceYears: String(job.experienceYears ?? 0),
    quantity: String(job.quantity ?? 1),
    skills: job.skills.join(", "),
    description: job.description,
    requirements: job.requirementsText ?? job.requirements.join("\n"),
    benefits: job.benefitsText ?? job.benefits.join("\n"),
  };
}

export default function EditRecruiterJobPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [job, setJob] = useState<Job | null>(null);
  const [draft, setDraft] = useState<RecruiterJobFormValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmPublishedEdit, setConfirmPublishedEdit] = useState(false);
  const [savedForSubmission, setSavedForSubmission] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [conflict, setConflict] = useState<ConflictSnapshot<RecruiterJobFormValues, Job> | null>(null);
  const [conflictStage, setConflictStage] = useState<"SAVE" | "SUBMIT">("SAVE");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getRecruiterJob(jobId, controller.signal)
      .then((response) => {
        if (!active) return;
        setJob(response.data);
        setDraft(toDraft(response.data));
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof ApiClientError && reason.code === "REQUEST_CANCELLED")) {
          setLoadError(toUserMessage(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [jobId, reloadKey]);

  const errors = useMemo(() => draft ? validateRecruiterJobForm(draft) : {}, [draft]);

  function change<K extends keyof RecruiterJobFormValues>(field: K, value: RecruiterJobFormValues[K]) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
    setSavedForSubmission(false);
    setMutationError("");
    setSuccessMessage("");
    setConflict(null);
  }

  async function submitForReview(event?: React.FormEvent<HTMLFormElement>, confirmed = false) {
    event?.preventDefault();
    if (!draft || !job || submitting) return;
    setAttempted(true);
    if (Object.keys(errors).length) {
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
    if (job.status === "PUBLISHED" && !confirmed && jobEditRequiresReview(toDraft(job), draft)) {
      setConfirmPublishedEdit(true);
      return;
    }
    setSubmitting(true);
    setMutationError("");
    setSuccessMessage("");
    let draftSaved = savedForSubmission;
    try {
      let savedJob = job;
      if (!draftSaved) {
        const updated = await updateRecruiterJob(job.id, {
          ...normalizeRecruiterJobForm(draft),
          expectedVersion: job.aggregateVersion,
        });
        savedJob = updated.data;
        setJob(savedJob);
        draftSaved = savedJob.status === "DRAFT";
        setSavedForSubmission(draftSaved);
      }
      if (savedJob.status === "DRAFT") {
        const submitted = await submitJobForApproval(job.id);
        setJob(submitted.data);
        setSuccessMessage("Đã lưu thay đổi và gửi tin cho admin duyệt.");
      } else {
        setSuccessMessage(savedJob.status === "PENDING_APPROVAL"
          ? "Đã lưu thay đổi. Tin đang chờ admin duyệt trước khi công khai."
          : "Đã lưu thay đổi.");
      }
      setSavedForSubmission(false);
      setConfirmPublishedEdit(false);
    } catch (reason: unknown) {
      try {
        const snapshot = await prepareConflictSnapshot({
          error: reason,
          localDraft: { ...draft },
          localVersion: job.aggregateVersion,
          reload: async () => (await getRecruiterJob(job.id)).data,
          serverVersion: (server) => server.aggregateVersion,
          fields: JOB_CONFLICT_FIELDS,
        });
        setJob(snapshot.server);
        setConflict(snapshot);
        setConflictStage(draftSaved ? "SUBMIT" : "SAVE");
        setMutationError("");
      } catch (recoveryError: unknown) {
        setMutationError(
          draftSaved
            ? `Bản sửa đã được lưu nhưng chưa gửi duyệt được. ${toUserMessage(recoveryError)}`
            : `Chưa lưu được bản sửa. ${toUserMessage(recoveryError)}`,
        );
      }
    } finally {
      setSubmitting(false);
      setConfirmPublishedEdit(false);
    }
  }

  if (loading) return <main><LoadingState label="Đang tải bản nháp tuyển dụng" /></main>;
  if (loadError || !job || !draft) {
    return <main><ErrorState message={loadError || "Không tìm thấy tin tuyển dụng."} onRetry={() => setReloadKey((value) => value + 1)} /></main>;
  }

  const editable = ["DRAFT", "PENDING_APPROVAL", "PUBLISHED"].includes(job.status);

  return (
    <main>
      <PageHeader
        eyebrow="RECRUITER · JOB REVIEW"
        title={job.rejectionReason ? "Sửa tin theo góp ý" : "Sửa tin tuyển dụng"}
        description="Sửa nội dung tuyển dụng. Với tin đang công khai, đổi tiêu đề, mô tả, yêu cầu, lương hoặc đơn vị tiền cần admin duyệt lại; hạn nộp, số lượng và các trường khác được cập nhật ngay."
        action={<Link className="btn" href="/recruiter/jobs">Về danh sách</Link>}
      />

      <ConfirmationDialog open={confirmPublishedEdit} title="Gửi tin tuyển dụng duyệt lại?" description={`Tin “${job.title}” sẽ tạm ngừng công khai sau khi lưu và chờ admin duyệt lại. Bản nhập của bạn được giữ nếu quay lại.`} confirmLabel="Lưu và gửi duyệt lại" pending={submitting} onConfirm={() => { void submitForReview(undefined, true); }} onCancel={() => setConfirmPublishedEdit(false)} />
      {job.rejectionReason && editable ? (
        <section className="notice notice-warning" role="note" aria-labelledby="job-review-feedback">
          <strong id="job-review-feedback">Góp ý từ admin</strong>
          <p>{job.rejectionReason}</p>
          <span className="help">Góp ý sẽ được giữ để đối chiếu cho đến khi tin được gửi duyệt lại thành công.</span>
        </section>
      ) : null}
      {!editable ? (
        <section className="notice" role="status">
          <strong>Tin không còn ở trạng thái có thể sửa.</strong>
          <p>Trạng thái hiện tại: <StatusBadge tone={job.status === "PUBLISHED" ? "success" : "warning"}>{job.status}</StatusBadge></p>
        </section>
      ) : null}
      {successMessage ? <p className="notice notice-success" role="status">{successMessage}</p> : null}
      {mutationError ? (
        <div className="notice notice-danger" role="alert">
          <strong>Chưa hoàn tất luồng gửi duyệt.</strong>
          <p>{mutationError}</p>
          {savedForSubmission ? <button className="btn btn-secondary" type="button" disabled={submitting} onClick={() => { void submitForReview(); }}>Thử gửi admin duyệt</button> : null}
        </div>
      ) : null}
      {conflict ? (
        <ConflictRecoveryPanel
          resourceName="Tin tuyển dụng"
          snapshot={conflict}
          onKeepDraft={() => {
            setJob(conflict.server);
            setSavedForSubmission(conflictStage === "SUBMIT" && conflict.server.status === "DRAFT");
            setConflict(null);
            setSuccessMessage("Đã giữ bản bạn nhập trên nền dữ liệu mới. Hãy kiểm tra và bấm gửi lại; CareerHub chưa tự phát lại mutation.");
          }}
          onUseServer={() => {
            setJob(conflict.server);
            setDraft(toDraft(conflict.server));
            setSavedForSubmission(false);
            setConflict(null);
            setSuccessMessage("Đã dùng bản mới nhất từ server.");
          }}
        />
      ) : null}

      <form className="panel form-grid" noValidate onSubmit={submitForReview}>
        <div className="field span-2">
          <label className="label" htmlFor="title">Tên vị trí</label>
          <input id="title" className="input" disabled={!editable || submitting} value={draft.title} onChange={(event) => change("title", event.target.value)} aria-invalid={attempted && !!errors.title} aria-describedby={attempted && errors.title ? "title-error" : undefined} />
          {attempted && errors.title ? <span id="title-error" className="form-error">{errors.title}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="location">Địa điểm</label>
          <input id="location" className="input" disabled={!editable || submitting} value={draft.location} onChange={(event) => change("location", event.target.value)} aria-invalid={attempted && !!errors.location} aria-describedby={attempted && errors.location ? "location-error" : undefined} />
          {attempted && errors.location ? <span id="location-error" className="form-error">{errors.location}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="jobType">Hình thức</label>
          <select id="jobType" className="select" disabled={!editable || submitting} value={draft.jobType} onChange={(event) => change("jobType", event.target.value as RecruiterJobFormValues["jobType"])}>
            <option value="FULL_TIME">Toàn thời gian</option>
            <option value="PART_TIME">Bán thời gian</option>
            <option value="REMOTE">Làm việc từ xa</option>
            <option value="INTERNSHIP">Thực tập</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="experienceYears">Số năm kinh nghiệm</label>
          <input id="experienceYears" className="input" type="number" min="0" max="60" step="1" disabled={!editable || submitting} value={draft.experienceYears} onChange={(event) => change("experienceYears", event.target.value)} aria-invalid={attempted && !!errors.experienceYears} aria-describedby={attempted && errors.experienceYears ? "experienceYears-error" : undefined} />
          {attempted && errors.experienceYears ? <span id="experienceYears-error" className="form-error">{errors.experienceYears}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="quantity">Số lượng tuyển</label>
          <input id="quantity" className="input" type="number" min="1" max="10000" step="1" disabled={!editable || submitting} value={draft.quantity} onChange={(event) => change("quantity", event.target.value)} aria-invalid={attempted && !!errors.quantity} aria-describedby={attempted && errors.quantity ? "quantity-error" : undefined} />
          {attempted && errors.quantity ? <span id="quantity-error" className="form-error">{errors.quantity}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="deadline">Hạn nộp</label>
          <input id="deadline" className="input" type="date" disabled={!editable || submitting} value={draft.deadline} onChange={(event) => change("deadline", event.target.value)} aria-invalid={attempted && !!errors.deadline} aria-describedby={attempted && errors.deadline ? "deadline-error" : undefined} />
          {attempted && errors.deadline ? <span id="deadline-error" className="form-error">{errors.deadline}</span> : null}
        </div>
        <div className="field">
          <span className="label">Chính sách lương</span>
          <label className="row"><input type="checkbox" disabled={!editable || submitting} checked={draft.isNegotiable} onChange={(event) => change("isNegotiable", event.target.checked)} /> Thỏa thuận khi phỏng vấn</label>
        </div>
        <div className="field"><label className="label" htmlFor="currency">Đơn vị tiền tệ</label><input id="currency" className="input" value={draft.currency} maxLength={3} disabled={!editable || submitting} onChange={(event) => change("currency", event.target.value.toUpperCase())} aria-invalid={attempted && !!errors.currency} aria-describedby={attempted && errors.currency ? "currency-error" : "currency-help"} />{attempted && errors.currency ? <span id="currency-error" className="form-error">{errors.currency}</span> : <span id="currency-help" className="help">Giữ nguyên đơn vị của tin, hoặc nhập mã tiền tệ mới như VND/USD.</span>}</div>
        {!draft.isNegotiable ? (
          <>
            <div className="field">
              <label className="label" htmlFor="salary">Lương tối thiểu</label>
              <input id="salary" className="input" inputMode="decimal" disabled={!editable || submitting} value={draft.salaryMin} onChange={(event) => change("salaryMin", event.target.value)} aria-invalid={attempted && !!errors.salary} aria-describedby={attempted && errors.salary ? "salary-error" : undefined} />
            </div>
            <div className="field">
              <label className="label" htmlFor="salaryMax">Lương tối đa</label>
              <input id="salaryMax" className="input" inputMode="decimal" disabled={!editable || submitting} value={draft.salaryMax} onChange={(event) => change("salaryMax", event.target.value)} aria-invalid={attempted && !!errors.salary} aria-describedby={attempted && errors.salary ? "salary-error" : undefined} />
              {attempted && errors.salary ? <span id="salary-error" className="form-error">{errors.salary}</span> : null}
            </div>
          </>
        ) : null}
        <div className="field span-2">
          <label className="label" htmlFor="skills">Kỹ năng, phân tách bằng dấu phẩy</label>
          <input id="skills" className="input" disabled={!editable || submitting} value={draft.skills} onChange={(event) => change("skills", event.target.value)} aria-invalid={attempted && !!errors.skills} aria-describedby={attempted && errors.skills ? "skills-error" : undefined} />
          {attempted && errors.skills ? <span id="skills-error" className="form-error">{errors.skills}</span> : null}
        </div>
        <div className="field span-2">
          <label className="label" htmlFor="description">Mô tả công việc</label>
          <textarea id="description" className="textarea resize-none" rows={7} disabled={!editable || submitting} value={draft.description} onChange={(event) => change("description", event.target.value)} aria-invalid={attempted && !!errors.description} aria-describedby={attempted && errors.description ? "description-error" : undefined} />
          {attempted && errors.description ? <span id="description-error" className="form-error">{errors.description}</span> : null}
        </div>
        <div className="field span-2">
          <label className="label" htmlFor="requirements">Yêu cầu ứng viên</label>
          <textarea id="requirements" className="textarea resize-none" rows={6} disabled={!editable || submitting} value={draft.requirements} onChange={(event) => change("requirements", event.target.value)} aria-invalid={attempted && !!errors.requirements} aria-describedby={attempted && errors.requirements ? "requirements-error" : undefined} />
          {attempted && errors.requirements ? <span id="requirements-error" className="form-error">{errors.requirements}</span> : null}
        </div>
        <div className="field span-2">
          <label className="label" htmlFor="benefits">Quyền lợi</label>
          <textarea id="benefits" className="textarea resize-none" rows={4} disabled={!editable || submitting} value={draft.benefits} onChange={(event) => change("benefits", event.target.value)} aria-invalid={attempted && !!errors.benefits} aria-describedby={attempted && errors.benefits ? "benefits-error" : undefined} />
          {attempted && errors.benefits ? <span id="benefits-error" className="form-error">{errors.benefits}</span> : null}
        </div>
        <div className="span-2 btn-group">
          {editable ? <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting}>{submitting ? "Đang lưu…" : savedForSubmission ? "Gửi admin duyệt" : job.status === "DRAFT" ? "Lưu và gửi admin duyệt" : "Lưu thay đổi"}</button> : null}
          <Link className="btn" href="/recruiter/jobs">Hủy</Link>
        </div>
      </form>
    </main>
  );
}
