import type { ApplicationStatus } from "./demoData";

export type RecruiterApplicationAction =
  | { kind: "STATUS"; status: "REVIEWING" | "INTERVIEW" | "REJECTED"; label: string; requiresReason: boolean }
  | { kind: "SEND_OFFER"; label: string };

export type CandidateApplicationAction =
  | { kind: "WITHDRAW"; label: string }
  | { kind: "RESPOND_OFFER"; label: string };

const RECRUITER_ACTIONS: Record<ApplicationStatus, RecruiterApplicationAction[]> = {
  APPLIED: [
    { kind: "STATUS", status: "REVIEWING", label: "Bắt đầu xem xét", requiresReason: false },
    { kind: "STATUS", status: "REJECTED", label: "Từ chối", requiresReason: true },
  ],
  REVIEWING: [
    { kind: "STATUS", status: "INTERVIEW", label: "Chuyển phỏng vấn", requiresReason: false },
    { kind: "STATUS", status: "REJECTED", label: "Từ chối", requiresReason: true },
  ],
  INTERVIEW: [
    { kind: "SEND_OFFER", label: "Soạn Offer" },
    { kind: "STATUS", status: "REJECTED", label: "Từ chối", requiresReason: true },
  ],
  OFFER: [{ kind: "STATUS", status: "REJECTED", label: "Thu hồi và từ chối", requiresReason: true }],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

const ACTIVE_CANDIDATE_STATUSES = new Set<ApplicationStatus>(["APPLIED", "REVIEWING", "INTERVIEW", "OFFER"]);

export function recruiterApplicationActions(status: ApplicationStatus): RecruiterApplicationAction[] {
  return RECRUITER_ACTIONS[status];
}

export function candidateApplicationActions(status: ApplicationStatus): CandidateApplicationAction[] {
  if (!ACTIVE_CANDIDATE_STATUSES.has(status)) return [];
  return status === "OFFER"
    ? [{ kind: "RESPOND_OFFER", label: "Phản hồi Offer" }, { kind: "WITHDRAW", label: "Rút hồ sơ" }]
    : [{ kind: "WITHDRAW", label: "Rút hồ sơ" }];
}

export function validateRecruiterApplicationStatus(
  currentStatus: ApplicationStatus,
  targetStatus: ApplicationStatus,
  reason?: string,
): string | null {
  const action = recruiterApplicationActions(currentStatus).find(
    (candidate) => candidate.kind === "STATUS" && candidate.status === targetStatus,
  );
  if (!action || action.kind !== "STATUS") return "Chuyển trạng thái này không hợp lệ.";
  if (action.requiresReason && !reason?.trim()) return "Vui lòng nhập lý do từ chối hồ sơ.";
  return null;
}
