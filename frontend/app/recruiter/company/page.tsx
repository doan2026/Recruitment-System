"use client";

import { useEffect, useState } from "react";
import { ConflictRecoveryPanel } from "../../../components/ConflictRecoveryPanel";
import { ConfirmationDialog } from "../../../components/ConfirmationDialog";
import { CompanyMediaUploader } from "../../../components/CompanyMediaUploader";
import { CompanyMediaLibrary } from "../../../components/CompanyMediaLibrary";
import { CompanyMemberInvitation } from "../../../components/CompanyMemberInvitation";
import { EmptyState, ErrorState, LoadingState, Metric, PageHeader, StatusBadge } from "../../../components/ui";
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
import { type Company, getCompany, resubmitCompanyVerification, updateCompany } from "../../../lib/person2Api";

type CompanyDraft = { name: string; taxCode: string };

export default function RecruiterCompanyPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [resubmitting, setResubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmationDraft, setConfirmationDraft] = useState<CompanyDraft | null>(null);
  const [conflict, setConflict] = useState<ConflictSnapshot<CompanyDraft, Company> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoadError(null);
    getCompany(controller.signal)
      .then((response) => {
        if (!active) return;
        setCompany(response.data);
        setName(response.data.name);
        setTaxCode(response.data.taxCode);
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
    if (!company || saving) return;
    setSaving(true);
    setSaveError("");
    setStatus("");
    setConflict(null);
    try {
      const response = await updateCompany(company.id, draft);
      setCompany(response.data);
      setName(response.data.name);
      setTaxCode(response.data.taxCode);
      setEditing(false);
      setStatus(needsReview
        ? "Thông tin pháp lý đã đổi. Hồ sơ được chuyển về chờ xác minh."
        : "Đã lưu thông tin công ty.");
    } catch (reason: unknown) {
      if (isOptimisticConflict(reason)) {
        try {
          const snapshot = await prepareConflictSnapshot({
            error: reason,
            localDraft: draft,
            localVersion: company.aggregateVersion,
            reload: async () => (await getCompany()).data,
            serverVersion: (server) => server.aggregateVersion,
            fields: [
              { key: "name", label: "Tên công ty", localValue: (value) => value.name, serverValue: (value) => value.name },
              { key: "taxCode", label: "Mã số thuế", localValue: (value) => value.taxCode, serverValue: (value) => value.taxCode },
            ],
          });
          setConflict(snapshot);
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
    if (!company || !name.trim() || !taxCode.trim() || saving) return;
    const draft = { name: name.trim(), taxCode: taxCode.trim() };
    if (requiresCompanyReverification(company, draft)) {
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
    if (!company || company.verificationStatus !== "REJECTED" || resubmitting) return;
    setResubmitting(true);
    setVerificationError("");
    setStatus("");
    try {
      const response = await resubmitCompanyVerification();
      setCompany(response.data);
      setName(response.data.name);
      setTaxCode(response.data.taxCode);
      setStatus("Đã gửi lại hồ sơ. Trạng thái đã chuyển về chờ xác minh.");
    } catch (reason: unknown) {
      if (isInvalidResubmissionTransition(reason)) {
        try {
          const latest = (await getCompany()).data;
          setCompany(latest);
          setName(latest.name);
          setTaxCode(latest.taxCode);
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
    setName(conflict.server.name);
    setTaxCode(conflict.server.taxCode);
    setConflict(null);
    setStatus("Đã dùng dữ liệu mới nhất từ hệ thống. Bạn có thể tiếp tục chỉnh sửa.");
  }

  function keepCompanyDraft() {
    if (!conflict) return;
    setCompany(conflict.server);
    setName(conflict.localDraft.name);
    setTaxCode(conflict.localDraft.taxCode);
    setConflict(null);
    setStatus("Đã làm mới dữ liệu nền và giữ nguyên phần bạn nhập. Kiểm tra rồi bấm Lưu thay đổi để gửi lại.");
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
        action={<button className="btn btn-primary" type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Đóng chỉnh sửa" : "Chỉnh sửa hồ sơ"}</button>}
      />

      <ConfirmationDialog
        open={confirmationDraft !== null}
        title="Thay đổi này cần xác minh lại"
        description="Bạn đang sửa tên hoặc mã số thuế của công ty đã được xác minh. Khi lưu, trạng thái công ty sẽ chuyển từ VERIFIED về PENDING và lý do từ chối cũ sẽ được xóa."
        confirmLabel="Xác nhận và lưu"
        pending={saving}
        onConfirm={() => { void confirmVerifiedEdit(); }}
        onCancel={() => setConfirmationDraft(null)}
      />

      {status ? <p className="notice notice-success" role="status">{status}</p> : null}
      {saveError ? <p className="notice notice-danger" role="alert"><strong>Chưa lưu được hồ sơ.</strong> {saveError}</p> : null}
      {verificationError ? <p className="notice notice-danger" role="alert"><strong>Chưa gửi lại được hồ sơ.</strong> {verificationError}</p> : null}

      <section className="metric-grid" aria-label="Tóm tắt công ty">
        <Metric label="Trạng thái" value={company.verificationStatus} detail="Xác minh doanh nghiệp" />
        <Metric label="Phiên bản" value={`v${company.aggregateVersion}`} detail="Optimistic concurrency" />
        <Metric label="Thành viên" value="12" detail="1 Owner · 11 Member" />
        <Metric label="Tin đang tuyển" value="5" detail="3 đang công khai" />
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
            {verification.canResubmit ? (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={resubmitVerification}
                disabled={resubmitting}
                aria-busy={resubmitting}
              >
                {resubmitting ? "Đang gửi lại…" : "Gửi lại để xác minh"}
              </button>
            ) : null}
          </div>

          {conflict ? (
            <ConflictRecoveryPanel
              resourceName="Hồ sơ công ty"
              snapshot={conflict}
              onKeepDraft={keepCompanyDraft}
              onUseServer={useServerCompany}
            />
          ) : null}

          {editing ? (
            <form className="form-grid" noValidate onSubmit={saveCompany}>
              <div className="field">
                <label className="label" htmlFor="company-name">Tên công ty</label>
                <input id="company-name" className="input" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!name.trim()} aria-describedby={!name.trim() ? "company-name-error" : undefined} />
                {!name.trim() ? <span id="company-name-error" className="form-error">Nhập tên công ty.</span> : null}
              </div>
              <div className="field">
                <label className="label" htmlFor="tax-code">Mã số thuế</label>
                <input id="tax-code" className="input" value={taxCode} onChange={(event) => setTaxCode(event.target.value)} aria-invalid={!taxCode.trim()} aria-describedby={!taxCode.trim() ? "tax-code-error" : undefined} />
                {!taxCode.trim() ? <span id="tax-code-error" className="form-error">Nhập mã số thuế.</span> : null}
              </div>
              <div className="span-2 btn-group">
                <button className="btn btn-primary" type="submit" disabled={!name.trim() || !taxCode.trim() || saving} aria-busy={saving}>
                  {saving ? "Đang lưu…" : "Lưu thay đổi"}
                </button>
                <button className="btn" type="button" disabled={saving} onClick={() => { setEditing(false); setConflict(null); setSaveError(""); setName(company.name); setTaxCode(company.taxCode); }}>Hủy</button>
              </div>
            </form>
          ) : null}
        </section>

        <aside className="panel">
          <h2>Luồng tải media</h2>
          <p className="help">Xin chữ ký → tải trực tiếp → xác nhận canonical → gắn fileId vào hồ sơ.</p>
          <CompanyMediaUploader
            company={company}
            onCompanyChange={(nextCompany) => {
              setCompany(nextCompany);
              setName(nextCompany.name);
              setTaxCode(nextCompany.taxCode);
            }}
          />
        </aside>
      </section>

      <CompanyMediaLibrary
        company={company}
        onCompanyChange={(nextCompany) => {
          setCompany(nextCompany);
          setName(nextCompany.name);
          setTaxCode(nextCompany.taxCode);
        }}
      />

      <CompanyMemberInvitation companyId={company.id} />
    </main>
  );
}
