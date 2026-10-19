"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../../lib/apiClient";
import {
  type CompanyCreateErrors,
  type CompanyCreateField,
  type CompanyCreateValues,
  emptyCompanyCreateValues,
  normalizeCompanyCreate,
  validateCompanyCreate,
} from "../../../../lib/companyForm";
import { createCompany } from "../../../../lib/person2Api";

export default function NewCompanyPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<CompanyCreateValues>(emptyCompanyCreateValues);
  const [errors, setErrors] = useState<CompanyCreateErrors>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: CompanyCreateField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = validateCompanyCreate(values);
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0] as CompanyCreateField | undefined;
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await createCompany(normalizeCompanyCreate(values));
      router.replace("/recruiter/company");
      router.refresh();
    } catch (reason: unknown) {
      setSubmitError(reason);
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyMember = submitError instanceof ApiClientError &&
    submitError.code === "RECRUITER_ALREADY_HAS_COMPANY";

  return (
    <main>
      <PageHeader
        eyebrow="DOANH NGHIỆP"
        title="Tạo hồ sơ công ty"
        description="Giới thiệu doanh nghiệp và bắt đầu quản lý tuyển dụng với vai trò chủ sở hữu."
      />

      <section className="grid-2">
        <form ref={formRef} className="panel form-grid" noValidate onSubmit={submit}>
          <div className="field span-2">
            <label className="label" htmlFor="company-create-name">Tên công ty</label>
            <input id="company-create-name" name="name" className="input" autoComplete="organization" value={values.name} onChange={(event) => update("name", event.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? "company-create-name-error" : undefined} />
            {errors.name ? <span id="company-create-name-error" className="form-error">{errors.name}</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="company-create-tax-code">Mã số thuế</label>
            <input id="company-create-tax-code" name="taxCode" className="input" inputMode="numeric" value={values.taxCode} onChange={(event) => update("taxCode", event.target.value)} aria-invalid={!!errors.taxCode} aria-describedby={errors.taxCode ? "company-create-tax-code-error" : undefined} />
            {errors.taxCode ? <span id="company-create-tax-code-error" className="form-error">{errors.taxCode}</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="company-create-industry">Lĩnh vực</label>
            <input id="company-create-industry" name="industry" className="input" value={values.industry} onChange={(event) => update("industry", event.target.value)} aria-invalid={!!errors.industry} aria-describedby={errors.industry ? "company-create-industry-error" : undefined} />
            {errors.industry ? <span id="company-create-industry-error" className="form-error">{errors.industry}</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="company-create-size">Quy mô</label>
            <input id="company-create-size" name="size" className="input" placeholder="Ví dụ: 51–200 nhân sự" value={values.size} onChange={(event) => update("size", event.target.value)} aria-invalid={!!errors.size} aria-describedby={errors.size ? "company-create-size-error" : undefined} />
            {errors.size ? <span id="company-create-size-error" className="form-error">{errors.size}</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="company-create-website">Website (không bắt buộc)</label>
            <input id="company-create-website" name="website" className="input" type="url" inputMode="url" autoComplete="url" placeholder="https://example.vn" value={values.website} onChange={(event) => update("website", event.target.value)} aria-invalid={!!errors.website} aria-describedby={errors.website ? "company-create-website-error" : undefined} />
            {errors.website ? <span id="company-create-website-error" className="form-error">{errors.website}</span> : null}
          </div>

          <div className="field span-2">
            <label className="label" htmlFor="company-create-address">Địa chỉ</label>
            <input id="company-create-address" name="address" className="input" autoComplete="street-address" value={values.address} onChange={(event) => update("address", event.target.value)} aria-invalid={!!errors.address} aria-describedby={errors.address ? "company-create-address-error" : undefined} />
            {errors.address ? <span id="company-create-address-error" className="form-error">{errors.address}</span> : null}
          </div>

          <div className="field span-2">
            <label className="label" htmlFor="company-create-description">Mô tả công ty</label>
            <textarea id="company-create-description" name="description" className="textarea resize-none" rows={6} value={values.description} onChange={(event) => update("description", event.target.value)} aria-invalid={!!errors.description} aria-describedby={errors.description ? "company-create-description-help company-create-description-error" : "company-create-description-help"} />
            <span id="company-create-description-help" className="help">Tối đa 10.000 ký tự.</span>
            {errors.description ? <span id="company-create-description-error" className="form-error">{errors.description}</span> : null}
          </div>

          {submitError ? (
            <div className="notice notice-danger span-2" role="alert">
              <strong>Chưa tạo được hồ sơ.</strong>
              <p>{toUserMessage(submitError)}</p>
              {alreadyMember ? <Link className="btn btn-secondary" href="/recruiter/company">Mở hồ sơ hiện có</Link> : null}
            </div>
          ) : null}

          <div className="span-2 btn-group">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? "Đang tạo hồ sơ…" : "Tạo hồ sơ công ty"}
            </button>
            <Link className="btn" href="/recruiter/company">Hủy</Link>
          </div>
        </form>

        <aside className="panel">
          <h2>Sau khi tạo hồ sơ</h2>
          <ol className="stack">
            <li className="card"><strong>1. Chờ xác minh</strong><p className="help">Hồ sơ mới sẽ chờ xác minh trước khi công khai.</p></li>
            <li className="card"><strong>2. Hoàn thiện hình ảnh</strong><p className="help">Bổ sung logo và hình ảnh để giới thiệu môi trường làm việc.</p></li>
            <li className="card"><strong>3. Mời thành viên</strong><p className="help">Bạn là chủ sở hữu đầu tiên và có thể mời nhà tuyển dụng khác cùng tham gia.</p></li>
          </ol>
        </aside>
      </section>
    </main>
  );
}
