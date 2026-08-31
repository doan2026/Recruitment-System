import type { ApplicationStatus } from "./demoData";

export type RecruiterApplicationSort = "APPLIED_AT_DESC" | "APPLIED_AT_ASC" | "MATCH_SCORE_DESC";

export interface RecruiterApplicationFilterDraft {
  status: "ALL" | ApplicationStatus;
  appliedFrom: string;
  appliedTo: string;
  skills: string;
  sort: RecruiterApplicationSort;
  size: number;
}

export interface RecruiterApplicationQuery {
  jobId?: string;
  status?: ApplicationStatus;
  appliedFrom?: string;
  appliedTo?: string;
  skills?: string[];
  sort: RecruiterApplicationSort;
  page: number;
  size: number;
}

function startOfUtcDate(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

function endOfUtcDate(value: string): string | undefined {
  return value ? `${value}T23:59:59.999Z` : undefined;
}

export function validateRecruiterApplicationFilters(draft: RecruiterApplicationFilterDraft): string | null {
  if (draft.appliedFrom && draft.appliedTo && draft.appliedFrom > draft.appliedTo) {
    return "Ngày nộp từ phải trước hoặc bằng ngày nộp đến.";
  }
  if (!Number.isInteger(draft.size) || draft.size < 1 || draft.size > 100) {
    return "Số dòng mỗi trang phải từ 1 đến 100.";
  }
  return null;
}

export function normalizeRecruiterApplicationQuery(
  jobId: string | undefined,
  draft: RecruiterApplicationFilterDraft,
  page: number,
): RecruiterApplicationQuery {
  const validationError = validateRecruiterApplicationFilters(draft);
  if (validationError) throw new Error(validationError);
  const skills = [...new Set(draft.skills.normalize("NFKC").split(",").map((skill) => skill.trim()).filter(Boolean))];
  return {
    jobId,
    status: draft.status === "ALL" ? undefined : draft.status,
    appliedFrom: startOfUtcDate(draft.appliedFrom),
    appliedTo: endOfUtcDate(draft.appliedTo),
    skills: skills.length ? skills : undefined,
    sort: draft.sort,
    page: Math.max(0, Math.floor(page)),
    size: draft.size,
  };
}

export function shouldRestartOffsetApplications(input: {
  page: number;
  expectedTotal: number | null;
  actualTotal: number;
  seenIds: ReadonlySet<string>;
  currentIds: readonly string[];
}): boolean {
  if (input.page === 0 || input.expectedTotal === null) return false;
  if (input.expectedTotal !== input.actualTotal) return true;
  return input.currentIds.some((id) => input.seenIds.has(id));
}
