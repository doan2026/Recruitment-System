"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader, StatusBadge } from "@/components/ui";
import { toUserMessage } from "../../../../lib/apiClient";
import {
  emptyRecruiterJobForm,
  normalizeRecruiterJobForm,
  validateRecruiterJobForm,
  type RecruiterJobFormValues,
} from "../../../../lib/jobForm";
import { createRecruiterJob, type Job } from "../../../../lib/person2Api";

export default function CreateJobPage() {
  const [values, setValues] = useState<RecruiterJobFormValues>(emptyRecruiterJobForm);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdJob, setCreatedJob] = useState<Job | null>(null);
  const errors = useMemo(() => validateRecruiterJobForm(values), [values]);

  function change<K extends keyof RecruiterJobFormValues>(field: K, value: RecruiterJobFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrorMessage("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || createdJob) return;
    setAttempted(true);
    if (Object.keys(errors).length) {
      const firstError = Object.keys(errors)[0];
      document.getElementById(firstError)?.focus();
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    try {
      const response = await createRecruiterJob(normalizeRecruiterJobForm(values));
      setCreatedJob(response.data);
    } catch (reason: unknown) {
      setErrorMessage(toUserMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <PageHeader eyebrow="RECRUITER · NEW JOB" title="Tạo tin tuyển dụng" description="Tin mới được lưu ở trạng thái bản nháp. Bạn sẽ chủ động gửi admin duyệt sau khi kiểm tra." />
      {createdJob ? (
        <section className="notice notice-success" role="status">
          <strong>Đã lưu bản nháp “{createdJob.title}”.</strong>
          <p>Trạng thái hiện tại: <StatusBadge>{createdJob.status}</StatusBadge>. Tin chưa được công khai.</p>
          <div className="btn-group"><Link className="btn btn-primary" href={`/recruiter/jobs/${createdJob.id}/edit`}>Kiểm tra và gửi duyệt</Link><Link className="btn" href="/recruiter/jobs">Về danh sách</Link></div>
        </section>
      ) : null}
      {attempted && Object.keys(errors).length > 0 ? <p className="notice notice-danger" role="alert">Kiểm tra lại {Object.keys(errors).length} nhóm thông tin chưa hợp lệ.</p> : null}
      {errorMessage ? <p className="notice notice-danger" role="alert"><strong>Chưa lưu được bản nháp.</strong> {errorMessage}</p> : null}

      <form className="panel form-grid" noValidate onSubmit={submit}>
        <div className="field span-2">
          <label className="label" htmlFor="title">Tên vị trí</label>
          <input id="title" className="input" disabled={!!createdJob} value={values.title} onChange={(event) => change("title", event.target.value)} aria-invalid={attempted && !!errors.title} aria-describedby={attempted && errors.title ? "title-error" : undefined} placeholder="Ví dụ: Senior Frontend Developer" />
          {attempted && errors.title ? <span id="title-error" className="form-error">{errors.title}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="location">Địa điểm</label>
          <input id="location" className="input" disabled={!!createdJob} value={values.location} onChange={(event) => change("location", event.target.value)} aria-invalid={attempted && !!errors.location} aria-describedby={attempted && errors.location ? "location-error" : undefined} />
          {attempted && errors.location ? <span id="location-error" className="form-error">{errors.location}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="jobType">Hình thức</label>
          <select id="jobType" className="select" disabled={!!createdJob} value={values.jobType} onChange={(event) => change("jobType", event.target.value as RecruiterJobFormValues["jobType"])}>
            <option value="FULL_TIME">Toàn thời gian</option>
            <option value="PART_TIME">Bán thời gian</option>
            <option value="REMOTE">Làm việc từ xa</option>
            <option value="INTERNSHIP">Thực tập</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="experienceYears">Số năm kinh nghiệm</label>
          <input id="experienceYears" className="input" type="number" min="0" max="60" step="1" disabled={!!createdJob} value={values.experienceYears} onChange={(event) => change("experienceYears", event.target.value)} aria-invalid={attempted && !!errors.experienceYears} aria-describedby={attempted && errors.experienceYears ? "experienceYears-error" : undefined} />
          {attempted && errors.experienceYears ? <span id="experienceYears-error" className="form-error">{errors.experienceYears}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="quantity">Số lượng tuyển</label>
          <input id="quantity" className="input" type="number" min="1" max="10000" step="1" disabled={!!createdJob} value={values.quantity} onChange={(event) => change("quantity", event.target.value)} aria-invalid={attempted && !!errors.quantity} aria-describedby={attempted && errors.quantity ? "quantity-error" : undefined} />
          {attempted && errors.quantity ? <span id="quantity-error" className="form-error">{errors.quantity}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="deadline">Hạn nộp</label>
          <input id="deadline" className="input" type="date" disabled={!!createdJob} value={values.deadline} onChange={(event) => change("deadline", event.target.value)} aria-invalid={attempted && !!errors.deadline} aria-describedby={attempted && errors.deadline ? "deadline-error" : undefined} />
          {attempted && errors.deadline ? <span id="deadline-error" className="form-error">{errors.deadline}</span> : null}
        </div>
        <div className="field">
          <span className="label">Chính sách lương</span>
          <label className="row"><input type="checkbox" disabled={!!createdJob} checked={values.isNegotiable} onChange={(event) => change("isNegotiable", event.target.checked)} /> Thỏa thuận khi phỏng vấn</label>
        </div>
        <div className="field">
          <label className="label" htmlFor="currency">Đơn vị tiền tệ</label>
          <input id="currency" className="input" maxLength={3} value={values.currency} disabled={submitting || !!createdJob} onChange={(event) => change("currency", event.target.value.toUpperCase())} aria-invalid={attempted && !!errors.currency} aria-describedby={attempted && errors.currency ? "currency-error" : "currency-help"} />
          {attempted && errors.currency ? <span id="currency-error" className="form-error">{errors.currency}</span> : <span id="currency-help" className="help">Mã tiền tệ, ví dụ VND hoặc USD.</span>}
        </div>
        {!values.isNegotiable ? (
          <>
            <div className="field">
              <label className="label" htmlFor="salary">Lương tối thiểu</label>
              <input id="salary" className="input" inputMode="decimal" disabled={!!createdJob} value={values.salaryMin} onChange={(event) => change("salaryMin", event.target.value)} aria-invalid={attempted && !!errors.salary} aria-describedby={attempted && errors.salary ? "salary-error" : undefined} placeholder="18000000" />
            </div>
            <div className="field">
              <label className="label" htmlFor="salaryMax">Lương tối đa</label>
              <input id="salaryMax" className="input" inputMode="decimal" disabled={!!createdJob} value={values.salaryMax} onChange={(event) => change("salaryMax", event.target.value)} aria-invalid={attempted && !!errors.salary} aria-describedby={attempted && errors.salary ? "salary-error" : undefined} placeholder="25000000" />
              {attempted && errors.salary ? <span id="salary-error" className="form-error">{errors.salary}</span> : null}
            </div>
          </>
        ) : null}
        <div className="field span-2">
          <label className="label" htmlFor="skills">Kỹ năng, phân tách bằng dấu phẩy</label>
          <input id="skills" className="input" disabled={!!createdJob} value={values.skills} onChange={(event) => change("skills", event.target.value)} aria-invalid={attempted && !!errors.skills} aria-describedby={attempted && errors.skills ? "skills-error" : undefined} />
          {attempted && errors.skills ? <span id="skills-error" className="form-error">{errors.skills}</span> : null}
        </div>
        <div className="field span-2">
          <label className="label" htmlFor="description">Mô tả công việc</label>
          <textarea id="description" className="textarea resize-none" rows={7} disabled={!!createdJob} value={values.description} onChange={(event) => change("description", event.target.value)} aria-invalid={attempted && !!errors.description} aria-describedby={attempted && errors.description ? "description-error" : undefined} />
          {attempted && errors.description ? <span id="description-error" className="form-error">{errors.description}</span> : null}
        </div>
        <div className="field span-2">
          <label className="label" htmlFor="requirements">Yêu cầu ứng viên</label>
          <textarea id="requirements" className="textarea resize-none" rows={6} disabled={!!createdJob} value={values.requirements} onChange={(event) => change("requirements", event.target.value)} aria-invalid={attempted && !!errors.requirements} aria-describedby={attempted && errors.requirements ? "requirements-error" : undefined} />
          {attempted && errors.requirements ? <span id="requirements-error" className="form-error">{errors.requirements}</span> : null}
        </div>
        <div className="field span-2">
          <label className="label" htmlFor="benefits">Quyền lợi</label>
          <textarea id="benefits" className="textarea resize-none" rows={4} disabled={!!createdJob} value={values.benefits} onChange={(event) => change("benefits", event.target.value)} aria-invalid={attempted && !!errors.benefits} aria-describedby={attempted && errors.benefits ? "benefits-error" : undefined} />
          {attempted && errors.benefits ? <span id="benefits-error" className="form-error">{errors.benefits}</span> : null}
        </div>
        <div className="span-2 btn-group"><button className="btn btn-primary" type="submit" disabled={submitting || !!createdJob} aria-busy={submitting}>{submitting ? "Đang lưu…" : "Lưu bản nháp"}</button><Link className="btn" href="/recruiter/jobs">Hủy</Link></div>
      </form>
    </main>
  );
}
