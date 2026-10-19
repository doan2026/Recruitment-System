"use client";

import { useEffect, useRef, useState } from "react";
import {
  createMediaIdempotencyKey,
  type CompanyMediaAssetType,
  type CompanyMediaUploadCapability,
  type CompanyMediaUploadResult,
  secondsUntilExpiry,
  uploadToSignedProvider,
  validateCompanyMediaFile,
} from "../lib/companyMediaUpload";
import { ApiClientError, toUserMessage } from "../lib/apiClient";
import { isTransientApiError } from "../lib/transientRecovery";
import { TransientRecoveryState } from "./TransientRecoveryState";
import {
  type Company,
  confirmCompanyMediaUpload,
  createCompanyMediaUploadIntent,
  isDemoPerson2Api,
  updateCompany,
} from "../lib/person2Api";

type UploadPhase = "idle" | "signed" | "uploaded" | "confirmed";

const TYPE_LABELS: Record<CompanyMediaAssetType, string> = {
  COMPANY_LOGO: "Logo công ty",
  COMPANY_IMAGE: "Ảnh không gian",
  COMPANY_VIDEO: "Video giới thiệu",
};

export function CompanyMediaUploader({
  company,
  onCompanyChange,
}: {
  company: Company;
  onCompanyChange: (company: Company) => void;
}) {
  const [type, setType] = useState<CompanyMediaAssetType>("COMPANY_LOGO");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [capability, setCapability] = useState<CompanyMediaUploadCapability | null>(null);
  const [confirmed, setConfirmed] = useState<CompanyMediaUploadResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [transientError, setTransientError] = useState<unknown>(null);
  const [failureCount, setFailureCount] = useState(0);
  const [status, setStatus] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastActionRef = useRef<((signal: AbortSignal) => Promise<void>) | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!capability) {
      setRemainingSeconds(0);
      return;
    }
    const update = () => setRemainingSeconds(secondsUntilExpiry(capability.expiresAt));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [capability]);

  function resetForSelection(nextFile: File | null, nextType = type) {
    controllerRef.current?.abort();
    setFile(nextFile);
    setType(nextType);
    setPhase("idle");
    setCapability(null);
    setConfirmed(null);
    setIdempotencyKey("");
    setError("");
    setTransientError(null);
    setStatus("");
    if (!nextFile && fileInputRef.current) fileInputRef.current.value = "";
  }

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (pending) return;
    lastActionRef.current = action;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError("");
    setTransientError(null);
    try {
      await action(controller.signal);
      setFailureCount(0);
    } catch (reason: unknown) {
      if (isTransientApiError(reason)) {
        setFailureCount((value) => value + 1);
        setTransientError(reason);
      } else {
        setError(toUserMessage(reason));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setPending(false);
    }
  }

  function requestSignature() {
    if (!file) {
      setError("Hãy chọn tệp trước khi bắt đầu tải lên.");
      return;
    }
    const localError = validateCompanyMediaFile(file, type);
    if (localError) {
      setError(localError);
      return;
    }
    void run(async (signal) => {
      const key = idempotencyKey || createMediaIdempotencyKey();
      setIdempotencyKey(key);
      const response = await createCompanyMediaUploadIntent(company.id, type, file.name, key, signal);
      const capabilityError = validateCompanyMediaFile(file, type, response.data);
      if (capabilityError) throw new ApiClientError({ code: "MEDIA_UPLOAD_POLICY_MISMATCH" });
      setCapability(response.data);
      setPhase("signed");
      setStatus("Đã sẵn sàng. Hãy tải tệp lên trước khi hết thời gian cho phép.");
    });
  }

  function uploadFile() {
    if (!file || !capability) return;
    const validationError = validateCompanyMediaFile(file, type, capability);
    if (validationError) {
      setError(validationError);
      setCapability(null);
      setPhase("idle");
      setIdempotencyKey("");
      return;
    }
    void run(async (signal) => {
      if (!isDemoPerson2Api) await uploadToSignedProvider(capability, file, signal);
      setPhase("uploaded");
      setStatus("Tệp đã tải lên. Hãy xác nhận để kiểm tra tệp trước khi lưu vào hồ sơ.");
    });
  }

  function confirmUpload() {
    if (!capability) return;
    if (remainingSeconds <= 0) {
      setError("Phiên tải lên đã hết hạn. Hãy chuẩn bị lại để tải tệp.");
      return;
    }
    void run(async (signal) => {
      const response = await confirmCompanyMediaUpload(company.id, capability.fileId, type, signal);
      setConfirmed(response.data);
      setPhase("confirmed");
      setStatus("File đã được xác nhận nhưng chưa gắn vào hồ sơ công ty.");
    });
  }

  function attachUpload() {
    if (!confirmed) return;
    void run(async (signal) => {
      const input = confirmed.type === "COMPANY_LOGO"
        ? { logo: { fileId: confirmed.fileId } }
        : {
            media: [
              ...company.media.gallery.map((item) => ({
                fileId: item.fileId,
                type: item.type,
                sortOrder: item.sortOrder,
              })),
              {
                fileId: confirmed.fileId,
                type: confirmed.type === "COMPANY_VIDEO" ? "VIDEO" as const : "IMAGE" as const,
                sortOrder: company.media.gallery.length,
              },
            ],
          };
      const response = await updateCompany(company.id, { ...input, expectedVersion: company.aggregateVersion }, signal);
      onCompanyChange(response.data);
      resetForSelection(null);
      setStatus("Đã lưu tệp vào hồ sơ công ty.");
    });
  }

  function discardConfirmed() {
    resetForSelection(null);
    setStatus("Đã bỏ tệp khỏi bản nháp. Tệp chưa được lưu vào hồ sơ sẽ được dọn tự động.");
  }

  function renewExpiredSignature() {
    setCapability(null);
    setConfirmed(null);
    setPhase("idle");
    setIdempotencyKey("");
    setError("");
    setStatus("Hãy chuẩn bị lại để tải tệp đã chọn. Phiên tải lên cũ sẽ được dọn tự động.");
  }

  const accept = type === "COMPANY_VIDEO" ? ".mp4,video/mp4" : ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

  return (
    <div className="stack company-media-uploader">
      <div className="field">
        <label className="label" htmlFor="company-media-type">Loại tệp</label>
        <select
          id="company-media-type"
          className="select"
          value={type}
          disabled={pending || phase !== "idle"}
          onChange={(event) => resetForSelection(null, event.target.value as CompanyMediaAssetType)}
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="company-media-file">File cần tải</label>
        <input
          ref={fileInputRef}
          id="company-media-file"
          className="input"
          type="file"
          accept={accept}
          disabled={pending || phase !== "idle"}
          onChange={(event) => resetForSelection(event.target.files?.[0] ?? null)}
        />
        <p className="help">{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "Logo tối đa 2 MB, ảnh 5 MB, video MP4 50 MB."}</p>
      </div>

      {capability && phase !== "confirmed" ? (
        <p className={remainingSeconds > 30 ? "notice notice-success" : "notice notice-warning"} role="status">
          Thời gian tải lên còn {remainingSeconds} giây.{remainingSeconds === 0 ? " Hãy chuẩn bị tải lên lại." : ""}
        </p>
      ) : null}
      {status ? <p className="notice notice-success" role="status">{status}</p> : null}
      {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
      {transientError ? (
        <TransientRecoveryState
          error={transientError}
          failureCount={failureCount}
          onRetry={() => { if (lastActionRef.current) void run(lastActionRef.current); }}
        />
      ) : null}

      <div className="btn-group">
        {phase === "idle" ? <button className="btn btn-secondary" type="button" disabled={pending || transientError !== null || !file} onClick={requestSignature}>{pending ? "Đang chuẩn bị…" : "1. Chuẩn bị tải lên"}</button> : null}
        {phase === "signed" ? <button className="btn btn-secondary" type="button" disabled={pending || transientError !== null || remainingSeconds === 0} onClick={uploadFile}>{pending ? "Đang tải…" : "2. Tải file"}</button> : null}
        {phase === "uploaded" ? <button className="btn btn-secondary" type="button" disabled={pending || transientError !== null || remainingSeconds === 0} onClick={confirmUpload}>{pending ? "Đang xác nhận…" : "3. Xác nhận file"}</button> : null}
        {remainingSeconds === 0 && (phase === "signed" || phase === "uploaded") ? <button className="btn" type="button" disabled={pending} onClick={renewExpiredSignature}>Chuẩn bị tải lại</button> : null}
        {phase === "confirmed" ? <button className="btn btn-primary" type="button" disabled={pending || transientError !== null} onClick={attachUpload}>{pending ? "Đang gắn…" : "Gắn vào hồ sơ"}</button> : null}
        {phase === "confirmed" ? <button className="btn" type="button" disabled={pending} onClick={discardConfirmed}>Bỏ file</button> : null}
      </div>
    </div>
  );
}
