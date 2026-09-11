import type { ConflictFieldDefinition } from "./conflictRecovery";
import type { Job, CandidateApplication } from "./demoData";
import type { RecruiterJobFormValues } from "./jobForm";

function serverJobType(job: Job): RecruiterJobFormValues["jobType"] {
  if (job.type === "FULLTIME") return "FULL_TIME";
  if (job.type === "PARTTIME") return "PART_TIME";
  return job.type;
}

export const JOB_CONFLICT_FIELDS: readonly ConflictFieldDefinition<RecruiterJobFormValues, Job>[] = [
  { key: "title", label: "Tên vị trí", localValue: (draft) => draft.title.trim(), serverValue: (job) => job.title },
  { key: "currency", label: "Đơn vị tiền tệ", localValue: (draft) => draft.currency.trim().toUpperCase(), serverValue: (job) => job.currency },
  { key: "location", label: "Địa điểm", localValue: (draft) => draft.location.trim(), serverValue: (job) => job.location },
  { key: "jobType", label: "Hình thức", localValue: (draft) => draft.jobType, serverValue: serverJobType },
  { key: "deadline", label: "Hạn nộp", localValue: (draft) => draft.deadline, serverValue: (job) => job.deadline.slice(0, 10) },
  { key: "salary", label: "Khoảng lương", localValue: (draft) => draft.isNegotiable ? "Thỏa thuận" : `${draft.salaryMin.trim()}–${draft.salaryMax.trim()}`, serverValue: (job) => job.isNegotiable ? "Thỏa thuận" : `${job.salaryMin}–${job.salaryMax ?? ""}` },
  { key: "skills", label: "Kỹ năng", localValue: (draft) => draft.skills.normalize("NFKC").split(",").map((value) => value.trim()).filter(Boolean).join(", "), serverValue: (job) => job.skills.join(", ") },
  { key: "description", label: "Mô tả", localValue: (draft) => draft.description.trim(), serverValue: (job) => job.description },
];

export interface ApplicationConflictDraft {
  intent: string;
  targetStatus: CandidateApplication["status"];
  note: string;
  applicationVersion: number;
}

export const APPLICATION_CONFLICT_FIELDS: readonly ConflictFieldDefinition<ApplicationConflictDraft, CandidateApplication>[] = [
  { key: "intent", label: "Thao tác của bạn", localValue: (draft) => draft.intent, serverValue: () => "Chưa áp dụng" },
  { key: "status", label: "Trạng thái", localValue: (draft) => draft.targetStatus, serverValue: (application) => application.status },
  { key: "version", label: "Phiên bản", localValue: (draft) => draft.applicationVersion, serverValue: (application) => application.version },
  { key: "note", label: "Ghi chú", localValue: (draft) => draft.note, serverValue: (application) => application.notes },
];
