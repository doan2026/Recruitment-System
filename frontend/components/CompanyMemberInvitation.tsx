"use client";

import { type FormEvent, useRef, useState } from "react";
import { toUserMessage } from "../lib/apiClient";
import { normalizeInvitationEmail, validateInvitationEmail } from "../lib/companyInvitation";
import { type CreatedCompanyInvitation, inviteCompanyMember } from "../lib/person2Api";

export function CompanyMemberInvitation({ companyId }: { companyId: string }) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [invitation, setInvitation] = useState<CreatedCompanyInvitation | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || invitation) return;
    const validationError = validateInvitationEmail(email);
    if (validationError) {
      setEmailError(validationError);
      emailRef.current?.focus();
      return;
    }

    const normalizedEmail = normalizeInvitationEmail(email);
    setSubmitting(true);
    setEmailError("");
    setRequestError("");
    setStatus("");
    try {
      const response = await inviteCompanyMember(companyId, normalizedEmail);
      setInvitation(response.data);
      setEmail(response.data.email);
      setStatus("Đã tạo lời mời. Hãy sao chép mã lời mời trước khi rời trang.");
      window.setTimeout(() => tokenRef.current?.focus(), 0);
    } catch (reason: unknown) {
      setRequestError(toUserMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToken() {
    if (!invitation) return;
    tokenRef.current?.select();
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(invitation.invitationToken);
      setStatus("Đã sao chép mã lời mời.");
    } catch {
      setStatus("Không thể tự sao chép. Mã lời mời đã được chọn; hãy nhấn Ctrl+C hoặc Cmd+C.");
    }
  }

  function dismissToken() {
    setInvitation(null);
    setEmail("");
    setStatus("Đã đóng mã lời mời. Hệ thống không thể hiển thị lại mã này.");
    window.setTimeout(() => emailRef.current?.focus(), 0);
  }

  return (
    <section className="panel company-invitation" aria-labelledby="company-invitation-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">MỜI THÀNH VIÊN</p>
          <h2 id="company-invitation-title">Mời nhà tuyển dụng</h2>
          <p className="help">Chủ sở hữu cần sao chép mã lời mời và gửi riêng cho người nhận. Hệ thống chưa tự gửi email.</p>
        </div>
        <span className="badge">Hiệu lực 7 ngày</span>
      </div>

      {status ? <p className="notice notice-success" role="status">{status}</p> : null}
      {requestError ? <p className="notice notice-danger" role="alert"><strong>Chưa tạo được lời mời.</strong> {requestError}</p> : null}

      {invitation ? (
        <div className="invitation-token-panel" aria-live="polite">
          <div className="notice notice-warning">
            <strong>Mã lời mời chỉ hiển thị trong lần này</strong>
            <p>Đóng hoặc tải lại trang sẽ không lấy lại được mã. Mời lại cùng email sẽ vô hiệu mã cũ.</p>
          </div>
          <div className="field">
            <label className="label" htmlFor="invitation-token">Mã lời mời dành cho {invitation.email}</label>
            <input
              ref={tokenRef}
              id="invitation-token"
              className="input invitation-token"
              value={invitation.invitationToken}
              readOnly
              spellCheck={false}
              autoComplete="off"
              onFocus={(event) => event.currentTarget.select()}
            />
            <span className="help">Hết hạn: {new Date(invitation.expiresAt).toLocaleString("vi-VN")}</span>
          </div>
          <div className="btn-group">
            <button className="btn btn-primary" type="button" onClick={() => { void copyToken(); }}>Sao chép mã lời mời</button>
            <button className="btn" type="button" onClick={dismissToken}>Tôi đã lưu mã</button>
          </div>
        </div>
      ) : (
        <form className="form-grid" noValidate onSubmit={submitInvitation}>
          <div className="field span-2">
            <label className="label" htmlFor="member-email">Email người được mời</label>
            <input
              ref={emailRef}
              id="member-email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              disabled={submitting}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "member-email-error" : "member-email-help"}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailError) setEmailError(validateInvitationEmail(event.target.value) ?? "");
              }}
            />
            {emailError ? <span id="member-email-error" className="form-error">{emailError}</span> : <span id="member-email-help" className="help">Nếu mời lại cùng email, mã lời mời đang hoạt động sẽ bị thay thế.</span>}
          </div>
          <div className="span-2">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? "Đang tạo lời mời…" : "Tạo mã lời mời"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
