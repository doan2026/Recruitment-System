"use client";

import { useEffect, useState } from "react";
import { ErrorState, Metric, PageHeader, StatusBadge } from "../../../components/ui";
import { toUserMessage } from "../../../lib/apiClient";
import { type Company, getCompany } from "../../../lib/person2Api";

type UploadStep = "idle" | "signed" | "uploaded" | "confirmed";

export default function RecruiterCompanyPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [editing, setEditing] = useState(false);
  const [uploadStep, setUploadStep] = useState<UploadStep>("idle");
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoadError("");
    getCompany(controller.signal)
      .then((response) => {
        if (!active) return;
        setCompany(response.data);
        setName(response.data.name);
        setTaxCode(response.data.taxCode);
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(toUserMessage(reason));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  function saveCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company || !name.trim() || !taxCode.trim()) return;
    const needsReview = company.verificationStatus === "VERIFIED" &&
      (name.trim() !== company.name || taxCode.trim() !== company.taxCode);
    setCompany({
      ...company,
      name: name.trim(),
      taxCode: taxCode.trim(),
      aggregateVersion: company.aggregateVersion + 1,
      verificationStatus: needsReview ? "PENDING" : company.verificationStatus,
      rejectReason: needsReview ? undefined : company.rejectReason,
    });
    setEditing(false);
    setStatus(needsReview ? "Thông tin pháp lý đã đổi. Hồ sơ được chuyển về chờ xác minh." : "Đã lưu thông tin công ty.");
  }

  function nextUploadStep() {
    const sequence: Record<UploadStep, UploadStep> = {
      idle: "signed",
      signed: "uploaded",
      uploaded: "confirmed",
      confirmed: "idle",
    };
    const next = sequence[uploadStep];
    setUploadStep(next);
    setStatus(next === "confirmed" ? "Media đã xác nhận. Hãy gắn file vào hồ sơ khi lưu." : "");
  }

  if (!company) {
    return (
      <main>
        {loadError ? <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} /> : <div className="loading-state" role="status">Đang tải hồ sơ công ty…</div>}
      </main>
    );
  }

  const tone = company.verificationStatus === "VERIFIED" ? "success" : company.verificationStatus === "REJECTED" ? "danger" : "warning";

  return (
    <main>
      <PageHeader
        eyebrow="RECRUITER · COMPANY"
        title="Hồ sơ công ty"
        description="Quản lý danh tính doanh nghiệp, trạng thái xác minh và thư viện hình ảnh."
        action={<button className="btn btn-primary" type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Đóng chỉnh sửa" : "Chỉnh sửa hồ sơ"}</button>}
      />

      {status ? <p className="notice notice-success" role="status">{status}</p> : null}

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
            <StatusBadge tone={tone}>{company.verificationStatus}</StatusBadge>
          </div>
          <div className="notice">
            <strong>Hồ sơ pháp lý</strong>
            <p className="help">Đổi tên hoặc mã số thuế khi đã xác minh sẽ đưa công ty về trạng thái chờ duyệt.</p>
          </div>
          {company.rejectReason ? <p className="notice notice-danger"><strong>Lý do từ chối:</strong> {company.rejectReason}</p> : null}

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
                <button className="btn btn-primary" type="submit" disabled={!name.trim() || !taxCode.trim()}>Lưu thay đổi</button>
                <button className="btn" type="button" onClick={() => { setEditing(false); setName(company.name); setTaxCode(company.taxCode); }}>Hủy</button>
              </div>
            </form>
          ) : null}
        </section>

        <aside className="panel">
          <h2>Luồng tải media</h2>
          <p className="help">Chữ ký → tải trực tiếp → xác nhận → gắn vào hồ sơ.</p>
          <ol className="stack">
            <li className={uploadStep !== "idle" ? "notice notice-success" : "card"}>1. Xin chữ ký có Idempotency-Key</li>
            <li className={["uploaded", "confirmed"].includes(uploadStep) ? "notice notice-success" : "card"}>2. Tải file lên uploadUrl</li>
            <li className={uploadStep === "confirmed" ? "notice notice-success" : "card"}>3. Xác nhận fileId</li>
          </ol>
          <button className="btn btn-secondary" type="button" onClick={nextUploadStep}>
            {uploadStep === "idle" ? "Bắt đầu tải logo" : uploadStep === "signed" ? "Mô phỏng tải file" : uploadStep === "uploaded" ? "Xác nhận media" : "Tải file khác"}
          </button>
        </aside>
      </section>

      <section className="panel">
        <div className="section-head"><h2>Thư viện công ty</h2><span className="help">2/10 ảnh · 0/1 video</span></div>
        <div className="grid-3">
          <div className="card"><strong>Logo chính</strong><p className="help">{company.media.logo?.fileId ?? "Chưa có logo"}</p></div>
          {company.media.gallery.map((item, index) => <div className="card" key={item.fileId}><strong>Không gian {index + 1}</strong><p className="help">{item.fileId}</p></div>)}
        </div>
      </section>
    </main>
  );
}
