"use client";

import Link from "next/link";
import { companyMemberRoleLabel } from "@/lib/recruitmentLabels";
import { companyVerificationView } from "@/lib/companyVerification";
import { type FormEvent, useRef, useState } from "react";
import { ApiClientError } from "../lib/apiClient";
import {
  type InvitationFailureView,
  invitationFailureView,
  validateInvitationToken,
} from "../lib/companyInvitationAcceptance";
import {
  type RecruiterCompanyMembership,
  acceptCompanyInvitation,
} from "../lib/person2Api";

export function CompanyInvitationAcceptance() {
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [failure, setFailure] = useState<InvitationFailureView | null>(null);
  const [membership, setMembership] = useState<RecruiterCompanyMembership | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const tokenRef = useRef<HTMLInputElement>(null);

  async function acceptToken() {
    if (submitting) return;
    const validationError = validateInvitationToken(token);
    if (validationError) {
      setTokenError(validationError);
      tokenRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setTokenError("");
    setFailure(null);
    try {
      const response = await acceptCompanyInvitation(token.trim());
      setMembership(response.data);
      setToken("");
    } catch (reason: unknown) {
      const error = reason instanceof ApiClientError
        ? reason
        : new ApiClientError({ code: "NETWORK_ERROR" });
      setFailure(invitationFailureView(error));
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void acceptToken();
  }

  function resetToken() {
    setToken("");
    setTokenError("");
    setFailure(null);
    window.setTimeout(() => tokenRef.current?.focus(), 0);
  }

  if (membership) {
    return (
      <section className="panel invitation-accept-success" aria-live="polite">
        <p className="eyebrow">ĐÃ THAM GIA</p>
        <h2>{membership.name}</h2>
        <p>Bạn đã tham gia với vai trò <strong>{companyMemberRoleLabel(membership.memberRole)}</strong>. Trạng thái công ty: {companyVerificationView(membership.verifiedStatus).title}.</p>
        <Link className="btn btn-primary" href="/recruiter/company">Mở hồ sơ công ty</Link>
      </section>
    );
  }

  return (
    <section className="panel invitation-accept-panel" aria-labelledby="invitation-accept-title">
      <div>
        <p className="eyebrow">LỜI MỜI THAM GIA</p>
        <h2 id="invitation-accept-title">Nhập mã từ chủ sở hữu</h2>
        <p className="help">Nhập mã lời mời do chủ sở hữu gửi riêng cho bạn. Mã chỉ được dùng trong biểu mẫu này.</p>
      </div>

      {failure ? (
        <div className="notice notice-danger" role="alert">
          <strong>{failure.title}</strong>
          <p>{failure.description}</p>
          {failure.action === "OPEN_COMPANY" ? (
            <Link className="btn" href="/recruiter/company">{failure.actionLabel}</Link>
          ) : failure.action === "RETRY" ? (
            <button className="btn" type="button" disabled={submitting} onClick={() => { void acceptToken(); }}>{failure.actionLabel}</button>
          ) : (
            <button className="btn" type="button" onClick={resetToken}>{failure.actionLabel}</button>
          )}
        </div>
      ) : null}

      <form className="form-grid" noValidate onSubmit={submit}>
        <div className="field span-2">
          <label className="label" htmlFor="accept-invitation-token">Mã lời mời</label>
          <input
            ref={tokenRef}
            id="accept-invitation-token"
            className="input invitation-token"
            value={token}
            minLength={32}
            maxLength={128}
            readOnly={submitting}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(tokenError)}
            aria-describedby={tokenError ? "accept-token-error" : "accept-token-help"}
            onChange={(event) => {
              setToken(event.target.value);
              setFailure(null);
              if (tokenError) setTokenError(validateInvitationToken(event.target.value) ?? "");
            }}
          />
          {tokenError ? <span id="accept-token-error" className="form-error">{tokenError}</span> : <span id="accept-token-help" className="help">Từ 32 đến 128 ký tự; khoảng trắng đầu/cuối sẽ được bỏ.</span>}
        </div>
        <div className="span-2 btn-group">
          <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? "Đang xác nhận…" : "Nhận lời mời"}
          </button>
          {token ? <button className="btn" type="button" disabled={submitting} onClick={resetToken}>Xóa mã lời mời</button> : null}
        </div>
      </form>
    </section>
  );
}
