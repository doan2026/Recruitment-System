"use client";

import { useEffect, useRef, useState } from "react";
import { ConflictRecoveryPanel } from "@/components/ConflictRecoveryPanel";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { CompanyMediaUploader } from "@/components/CompanyMediaUploader";
import { CompanyMediaLibrary } from "@/components/CompanyMediaLibrary";
import { CompanyMemberInvitation } from "@/components/CompanyMemberInvitation";
import { CompanyMemberManagement } from "@/components/CompanyMemberManagement";
import { EmptyState, ErrorState, LoadingState, Metric, PageHeader, StatusBadge } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import {
  type ConflictSnapshot,
  isOptimisticConflict,
  prepareConflictSnapshot,
} from "../../../lib/conflictRecovery";
import {
  companyVerificationView,
  isInvalidResubmissionTransition,
  requiresCompanyReverification,
} from "../../../lib/companyVerification";
import { type Company, type CompanyMemberRole, getCompany, resubmitCompanyVerification, updateCompany } from "../../../lib/person2Api";

import { emptyCompanyCreateValues, type CompanyCreateErrors, type CompanyCreateField } from "../../../lib/companyForm";
import {
  buildCompanyEditUpdate,
  COMPANY_EDIT_CONFLICT_FIELDS,
  companyEditValues,
  isCompanyEditDirty,
  validateCompanyEdit,
  type CompanyEditValues,
} from "../../../lib/companyEditForm";

type CompanyDraft = CompanyEditValues;

export default function RecruiterCompanyPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  // Keep the form's original version separate from updates made by media controls.
  const [formSnapshot, setFormSnapshot] = useState<Company | null>(null);
  const [values, setValues] = useState<CompanyDraft>(emptyCompanyCreateValues);
  const [errors, setErrors] = useState<CompanyCreateErrors>({});
  const [discarding, setDiscarding] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [resubmitting, setResubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmationDraft, setConfirmationDraft] = useState<CompanyDraft | null>(null);
  const [conflict, setConflict] = useState<ConflictSnapshot<CompanyDraft, Company> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [memberRole, setMemberRole] = useState<CompanyMemberRole | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoadError(null);
    getCompany(controller.signal)
      .then((response) => {
        if (!active) return;
        setCompany(response.data);
        setFormSnapshot(response.data);
        setValues(companyEditValues(response.data));
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(reason);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  async function persistCompany(draft: CompanyDraft, needsReview: boolean) {
    if (!company || !formSnapshot || saving || conflict || memberRole !== "OWNER") return;
    const snapshot = formSnapshot;
    setSaving(true);
    setSaveError("");
    setStatus("");
    setConflict(null);
    try {
      const response = await updateCompany(company.id, buildCompanyEditUpdate(draft, snapshot));
      setCompany(response.data);
      setFormSnapshot(response.data);
      setValues(companyEditValues(response.data));
      setErrors({});
      setEditing(false);
      setTimeout(() => editButtonRef.current?.focus(), 0);
      setStatus(needsReview
        ? "Thông tin pháp lý đã đổi. Hồ sơ được chuyển về chờ xác minh."
        : "Đã lưu thông tin công ty.");
    } catch (reason: unknown) {
      if (isOptimisticConflict(reason)) {
        try {
          const recovered = await prepareConflictSnapshot({
            error: reason,
            localDraft: draft,
            localVersion: snapshot.aggregateVersion,
            reload: async () => (await getCompany()).data,
            serverVersion: (server) => server.aggregateVersion,
            fields: COMPANY_EDIT_CONFLICT_FIELDS,
          });
          setConflict(recovered);
        } catch (reloadReason: unknown) {
          setSaveError(toUserMessage(reloadReason));
        }
      } else {
        setSaveError(toUserMessage(reason));
      }
    } finally {
      setSaving(false);
    }
  }

  function saveCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company || !formSnapshot || saving || conflict || memberRole !== "OWNER") return;
    const nextErrors = validateCompanyEdit(values);
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0] as CompanyCreateField | undefined;
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    const draft = { ...values };
    if (requiresCompanyReverification(formSnapshot, draft)) {
      setConfirmationDraft(draft);
      return;
    }
    void persistCompany(draft, false);
  }

  async function confirmVerifiedEdit() {
    if (!confirmationDraft || saving) return;
    await persistCompany(confirmationDraft, true);
    setConfirmationDraft(null);
  }

  async function resubmitVerification() {
    if (!company || company.verificationStatus !== "REJECTED" || resubmitting || editing || saving || memberRole !== "OWNER") return;
    setResubmitting(true);
    setVerificationError("");
    setStatus("");
    try {
      const response = await resubmitCompanyVerification();
      setCompany(response.data);
      setFormSnapshot(response.data);
      setValues(companyEditValues(response.data));
      setStatus("Đã gửi lại hồ sơ. Trạng thái đã chuyển về chờ xác minh.");
    } catch (reason: unknown) {
      if (isInvalidResubmissionTransition(reason)) {
        try {
          const latest = (await getCompany()).data;
          setCompany(latest);
          setFormSnapshot(latest);
          setValues(companyEditValues(latest));
          setStatus("Trạng thái đã thay đổi ở nơi khác. Đã tải dữ liệu mới nhất.");
        } catch (reloadReason: unknown) {
          setVerificationError(toUserMessage(reloadReason));
        }
      } else {
        setVerificationError(toUserMessage(reason));
      }
    } finally {
      setResubmitting(false);
    }
  }

  function useServerCompany() {
    if (!conflict) return;
    setCompany(conflict.server);
    setFormSnapshot(conflict.server);
    setValues(companyEditValues(conflict.server));
    setErrors({});
    setConflict(null);
    setStatus("Đã dùng dữ liệu mới nhất từ hệ thống. Bạn có thể tiếp tục chỉnh sửa.");
  }

  function keepCompanyDraft() {
    if (!conflict) return;
    setCompany(conflict.server);
    setFormSnapshot(conflict.server);
    setValues(conflict.localDraft);
    setErrors({});
    setConflict(null);
    setStatus("Đã làm mới dữ liệu nền và giữ nguyên phần bạn nhập. Kiểm tra rồi bấm Lưu thay đổi để gửi lại.");
  }

  function changeField(field: CompanyCreateField, value: string) {
    if (saving || conflict) return;
    const next = { ...values, [field]: value };
    setValues(next);
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: validateCompanyEdit(next)[field] }));
    }
  }

  function closeEditor() {
    if (!company || saving) return;
    setEditing(false);
    setDiscarding(false);
    setConflict(null);
    setSaveError("");
    setErrors({});
    setFormSnapshot(company);
    setValues(companyEditValues(company));
    setTimeout(() => editButtonRef.current?.focus(), 0);
  }

  function toggleEditor() {
    if (!company || saving || resubmitting || memberRole !== "OWNER") return;
    if (editing) {
      if (formSnapshot && isCompanyEditDirty(values, formSnapshot)) setDiscarding(true);
      else closeEditor();
      return;
    }
    setFormSnapshot(company);
    setValues(companyEditValues(company));
    setErrors({});
    setSaveError("");
    setStatus("");
    setEditing(true);
  }

  function receiveCompanyUpdate(nextCompany: Company) {
    setCompany(nextCompany);
    if (!editing) {
      setFormSnapshot(nextCompany);
      setValues(companyEditValues(nextCompany));
    }
  }

  const needsOnboarding = loadError instanceof ApiClientError && loadError.code === "COMPANY_NOT_FOUND";

  if (!company) {
    return (
      <main>
        <PageHeader
          eyebrow="RECRUITER · COMPANY"
          title="Hồ sơ công ty"
          description="Tạo danh tính doanh nghiệp trước khi đăng tin và mời thành viên."
        />
        {needsOnboarding ? (
          <section className="panel">
            <EmptyState
              title="Bạn chưa có hồ sơ công ty"
              description="Bắt đầu bằng thông tin pháp lý và doanh nghiệp. Hồ sơ mới sẽ ở trạng thái chờ xác minh."
              href="/recruiter/company/new"
              action="Tạo hồ sơ công ty"
            />
          </section>
        ) : loadError ? (
          <ErrorState message={toUserMessage(loadError)} onRetry={() => setReloadKey((value) => value + 1)} />
        ) : (
          <LoadingState label="Đang tải hồ sơ công ty" />
        )}
      </main>
    );
  }

  const verification = companyVerificationView(company.verificationStatus, company.rejectReason);
  const verificationNoticeClass = "notice notice-" + verification.tone;

  return (
    <main>
      <PageHeader
        eyebrow="RECRUITER · COMPANY"
        title="Hồ sơ công ty"
        description="Quản lý danh tính doanh nghiệp, trạng thái xác minh và thư viện hình ảnh."
        action={memberRole === "OWNER" ? <button ref={editButtonRef} className="btn btn-primary" type="button" disabled={saving || resubmitting} onClick={toggleEditor}>{editing ? "Đóng chỉnh sửa" : "Chỉnh sửa hồ sơ"}</button> : undefined}
      />

      <ConfirmationDialog
        open={confirmationDraft !== null}
        title="Thay đổi này cần xác minh lại"
        description="Bạn đang sửa tên hoặc mã số thuế của công ty đã được xác minh. Khi lưu, trạng thái công ty sẽ chuyển từ VERIFIED về PENDING để Admin xác minh lại và lý do từ chối cũ sẽ được xóa."
        confirmLabel="Xác nhận và lưu"
        pending={saving}
        onConfirm={() => { void confirmVerifiedEdit(); }}
        onCancel={() => setConfirmationDraft(null)}
      />

      <ConfirmationDialog
        open={discarding}
        title="Bỏ các thay đổi chưa lưu?"
        description="Các trường hồ sơ bạn vừa nhập chưa được lưu. Bỏ thay đổi để đóng form, hoặc quay lại tiếp tục chỉnh sửa."
        confirmLabel="Bỏ thay đổi"
        onConfirm={closeEditor}
        onCancel={() => setDiscarding(false)}
      />

      {status ? <p className="notice notice-success" role="status">{status}</p> : null}
      {saveError ? <p className="notice notice-danger" role="alert"><strong>Chưa lưu được hồ sơ.</strong> {saveError}</p> : null}
      {verificationError ? <p className="notice notice-danger" role="alert"><strong>Chưa gửi lại được hồ sơ.</strong> {verificationError}</p> : null}

      <section className="metric-grid" aria-label="Tóm tắt công ty">
        <Metric label="Trạng thái" value={company.verificationStatus} detail="Xác minh doanh nghiệp" />
        <Metric label="Phiên bản" value={`v${company.aggregateVersion}`} detail="Optimistic concurrency" />
        <Metric label="Quyền công ty" value={memberRole ?? "Đang tải"} detail="Authoritative membership" />
        <Metric label="Tin đang tuyển" value="—" detail="Chưa có dữ liệu thống kê" />
      </section>

      <section className="grid-2">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>{company.name}</h2>
              <p className="help">MST {company.taxCode} · Chủ sở hữu {company.ownerName}</p>
            </div>
            <StatusBadge tone={verification.tone}>{company.verificationStatus}</StatusBadge>
          </div>
          <div className="notice">
            <strong>Hồ sơ pháp lý</strong>
            <p className="help">Đổi tên hoặc mã số thuế khi đã xác minh sẽ đưa công ty về trạng thái chờ duyệt.</p>
          </div>
          <div className={verificationNoticeClass} aria-live="polite">
            <strong>{verification.title}</strong>
            <p>{verification.description}</p>
            {verification.rejectReason ? (
              <p><strong>Lý do từ chối:</strong> {verification.rejectReason}</p>
            ) : null}
            {verification.canResubmit && memberRole === "OWNER" ? (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={resubmitVerification}
                disabled={resubmitting || editing || saving}
                aria-busy={resubmitting}
              >
                {resubmitting ? "Đang gửi lại…" : "Gửi lại để xác minh"}
              </button>
            ) : null}
          </div>

          {!editing ? (
            <dl className="stack">
              <div><dt className="label">Lĩnh vực</dt><dd>{company.industry || "Chưa cập nhật"}</dd></div>
              <div><dt className="label">Quy mô</dt><dd>{company.size || "Chưa cập nhật"}</dd></div>
              <div><dt className="label">Địa chỉ</dt><dd>{company.address || "Chưa cập nhật"}</dd></div>
              <div><dt className="label">Website</dt><dd>{company.website || "Chưa cập nhật"}</dd></div>
              <div><dt className="label">Mô tả công ty</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{company.description || "Chưa cập nhật"}</dd></div>
            </dl>
          ) : null}
          {editing && verification.canResubmit ? <p className="help">Lưu hoặc đóng chỉnh sửa trước khi gửi lại hồ sơ để xác minh.</p> : null}

          {conflict ? (
            <ConflictRecoveryPanel
              resourceName="Hồ sơ công ty"
              snapshot={conflict}
              onKeepDraft={keepCompanyDraft}
              onUseServer={useServerCompany}
            />
          ) : null}

          {editing && memberRole === "OWNER" ? (
            <form ref={formRef} className="form-grid" noValidate onSubmit={saveCompany} aria-busy={saving}>
              <div className="field span-2">
                <label className="label" htmlFor="company-name">Tên công ty</label>
                <input id="company-name" name="name" className="input" autoComplete="organization" value={values.name} disabled={saving || conflict !== null} onChange={(event) => changeField("name", event.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? "company-name-error" : undefined} />
                {errors.name ? <span id="company-name-error" className="form-error">{errors.name}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="tax-code">Mã số thuế</label>
                <input id="tax-code" name="taxCode" className="input" inputMode="numeric" value={values.taxCode} disabled={saving || conflict !== null} onChange={(event) => changeField("taxCode", event.target.value)} aria-invalid={!!errors.taxCode} aria-describedby={errors.taxCode ? "tax-code-error" : undefined} />
                {errors.taxCode ? <span id="tax-code-error" className="form-error">{errors.taxCode}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="company-industry">Lĩnh vực</label>
                <input id="company-industry" name="industry" className="input" value={values.industry} disabled={saving || conflict !== null} onChange={(event) => changeField("industry", event.target.value)} aria-invalid={!!errors.industry} aria-describedby={errors.industry ? "company-industry-error" : undefined} />
                {errors.industry ? <span id="company-industry-error" className="form-error">{errors.industry}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="company-size">Quy mô</label>
                <input id="company-size" name="size" className="input" placeholder="Ví dụ: 51–200 nhân sự" value={values.size} disabled={saving || conflict !== null} onChange={(event) => changeField("size", event.target.value)} aria-invalid={!!errors.size} aria-describedby={errors.size ? "company-size-error" : undefined} />
                {errors.size ? <span id="company-size-error" className="form-error">{errors.size}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="company-website">Website (không bắt buộc)</label>
                <input id="company-website" name="website" className="input" type="url" inputMode="url" autoComplete="url" placeholder="https://example.vn" value={values.website} disabled={saving || conflict !== null} onChange={(event) => changeField("website", event.target.value)} aria-invalid={!!errors.website} aria-describedby={errors.website ? "company-website-error" : undefined} />
                {errors.website ? <span id="company-website-error" className="form-error">{errors.website}</span> : null}
              </div>

              <div className="field span-2">
                <label className="label" htmlFor="company-address">Địa chỉ</label>
                <input id="company-address" name="address" className="input" autoComplete="street-address" value={values.address} disabled={saving || conflict !== null} onChange={(event) => changeField("address", event.target.value)} aria-invalid={!!errors.address} aria-describedby={errors.address ? "company-address-error" : undefined} />
                {errors.address ? <span id="company-address-error" className="form-error">{errors.address}</span> : null}
              </div>

              <div className="field span-2">
                <label className="label" htmlFor="company-description">Mô tả công ty</label>
                <textarea id="company-description" name="description" className="textarea resize-none" rows={6} value={values.description} disabled={saving || conflict !== null} onChange={(event) => changeField("description", event.target.value)} aria-invalid={!!errors.description} aria-describedby={errors.description ? "company-description-error company-description-help" : "company-description-help"} />
                <span id="company-description-help" className="help">Tối đa 10.000 ký tự.</span>
                {errors.description ? <span id="company-description-error" className="form-error">{errors.description}</span> : null}
              </div>

              <div className="span-2 btn-group">
                <button className="btn btn-primary" type="submit" disabled={saving || conflict !== null} aria-busy={saving}>
                  {saving ? "Đang lưu…" : "Lưu thay đổi"}
                </button>
                <button className="btn" type="button" disabled={saving} onClick={toggleEditor}>Hủy</button>
              </div>
              {conflict ? <p className="help span-2">Chọn cách xử lý bản cập nhật ở trên trước khi tiếp tục chỉnh sửa.</p> : null}
            </form>
          ) : null}
        </section>

        {memberRole === "OWNER" ? <aside className="panel">
          <h2>Luồng tải media</h2>
          <p className="help">Xin chữ ký → tải trực tiếp → xác nhận canonical → gắn fileId vào hồ sơ.</p>
          <CompanyMediaUploader
            company={company}
            onCompanyChange={receiveCompanyUpdate}
          />
        </aside> : <aside className="panel"><h2>Quyền MEMBER</h2><p className="help">Thư viện media và thay đổi pháp lý chỉ dành cho OWNER.</p></aside>}
      </section>

      {memberRole === "OWNER" ? <CompanyMediaLibrary
        company={company}
        onCompanyChange={receiveCompanyUpdate}
      /> : null}

      <CompanyMemberManagement companyId={company.id} onRoleChange={setMemberRole} />
      {memberRole === "OWNER" ? <CompanyMemberInvitation companyId={company.id} /> : null}
    </main>
  );
}
