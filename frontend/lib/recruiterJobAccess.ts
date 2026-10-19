import { ApiClientError } from "./apiClientCore";

export type RecruiterJobScopeRole = "OWNER" | "MEMBER";

export interface RecruiterJobScopeView {
  label: string;
  description: string;
  tone: "success" | "info";
}

export function recruiterJobScopeView(role: RecruiterJobScopeRole): RecruiterJobScopeView {
  if (role === "OWNER") {
    return {
      label: "Chủ sở hữu · Toàn công ty",
      description: "Bạn đang xem mọi tin tuyển dụng thuộc công ty, gồm cả tin do thành viên khác tạo.",
      tone: "success",
    };
  }
  return {
    label: "Thành viên · Tin của bạn",
    description: "Bạn có thể xem và quản lý những tin do bạn tạo.",
    tone: "info",
  };
}

export function isRecruiterJobAccessDenied(error: unknown): boolean {
  return error instanceof ApiClientError
    && error.status === 403
    && error.code === "JOB_ACCESS_DENIED";
}
