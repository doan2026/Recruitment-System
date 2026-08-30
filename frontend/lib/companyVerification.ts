import { ApiClientError } from "./apiClientCore";
import type { CompanyVerificationStatus } from "./demoData";

export type VerificationTone = "success" | "danger" | "warning";

export interface CompanyVerificationView {
  tone: VerificationTone;
  title: string;
  description: string;
  canResubmit: boolean;
  rejectReason: string | null;
}

export function companyVerificationView(
  status: CompanyVerificationStatus,
  rejectReason?: string,
): CompanyVerificationView {
  if (status === "VERIFIED") {
    return {
      tone: "success",
      title: "Đã xác minh",
      description: "Doanh nghiệp đã được xác minh và có thể sử dụng đầy đủ tính năng tuyển dụng.",
      canResubmit: false,
      rejectReason: null,
    };
  }

  if (status === "REJECTED") {
    return {
      tone: "danger",
      title: "Cần bổ sung hồ sơ",
      description: "Cập nhật thông tin theo lý do bên dưới rồi gửi lại để Admin xem xét.",
      canResubmit: true,
      rejectReason: rejectReason?.trim() || "Admin chưa cung cấp lý do cụ thể.",
    };
  }

  if (status === "DRAFT") {
    return {
      tone: "warning",
      title: "Hồ sơ chưa gửi",
      description: "Hoàn thiện thông tin doanh nghiệp trước khi gửi xác minh.",
      canResubmit: false,
      rejectReason: null,
    };
  }

  return {
    tone: "warning",
    title: "Đang chờ xác minh",
    description: "Hồ sơ đã được gửi và đang chờ Admin xem xét.",
    canResubmit: false,
    rejectReason: null,
  };
}

export function isInvalidResubmissionTransition(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError &&
    error.status === 409 &&
    error.code === "INVALID_RESUBMISSION_TRANSITION";
}

export function requiresCompanyReverification(
  company: {
    verificationStatus: CompanyVerificationStatus;
    name: string;
    taxCode: string;
  },
  draft: {
    name: string;
    taxCode: string;
  },
): boolean {
  if (company.verificationStatus !== "VERIFIED") return false;
  return draft.name.trim() !== company.name.trim() ||
    draft.taxCode.trim() !== company.taxCode.trim();
}
