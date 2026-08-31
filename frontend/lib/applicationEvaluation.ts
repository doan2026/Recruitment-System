import { ApiClientError } from "./apiClientCore";

export interface EvaluationDraft {
  score: string;
  technical: string;
  communication: string;
  culture: string;
  note: string;
}

function parseScore(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const score = Number(normalized);
  return score >= 0 && score <= 100 ? score : null;
}

export function normalizeEvaluationDraft(draft: EvaluationDraft) {
  const score = parseScore(draft.score);
  const technical = parseScore(draft.technical);
  const communication = parseScore(draft.communication);
  const culture = parseScore(draft.culture);
  if (score === null || technical === null || communication === null || culture === null) {
    throw new ApiClientError({ code: "INVALID_EVALUATION_SCORE" });
  }
  const note = draft.note.trim();
  if (note.length > 2_000) throw new ApiClientError({ code: "INVALID_EVALUATION_NOTE" });
  return {
    score,
    criteria: { technical, communication, culture },
    note: note || undefined,
  };
}

export function isEvaluationAlreadyExists(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409 && error.code === "EVALUATION_ALREADY_EXISTS";
}
