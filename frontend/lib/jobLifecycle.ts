import type { JobStatus } from "./person2Api";

export type RecruiterJobAction = "SUBMIT_FOR_APPROVAL" | "CLOSE";

export function recruiterJobActions(status: JobStatus): RecruiterJobAction[] {
  if (status === "DRAFT") return ["SUBMIT_FOR_APPROVAL"];
  if (status === "PUBLISHED") return ["CLOSE"];
  return [];
}

export function recruiterJobActionLabel(action: RecruiterJobAction): string {
  return action === "SUBMIT_FOR_APPROVAL" ? "Gửi admin duyệt" : "Đóng tin";
}

export function nextRecruiterJobStatus(action: RecruiterJobAction): JobStatus {
  return action === "SUBMIT_FOR_APPROVAL" ? "PENDING_APPROVAL" : "CLOSED";
}
