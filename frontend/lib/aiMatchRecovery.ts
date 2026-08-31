import { ApiClientError } from "./apiClientCore";

export const AI_MATCH_POLL_DELAY_MS = 5_000;

const REASON_COPY: Record<string, string> = {
  CV_EMBEDDING_NOT_FOUND: "CV đang chờ AI lập chỉ mục.",
  JOB_EMBEDDING_NOT_FOUND: "Tin tuyển dụng đang chờ AI lập chỉ mục.",
  CV_AND_JOB_EMBEDDINGS_NOT_FOUND: "CV và tin tuyển dụng đều đang chờ AI lập chỉ mục.",
  EMBEDDING_MODEL_MISMATCH: "CV và tin tuyển dụng đang được đồng bộ lại cùng phiên bản mô hình.",
};

export function aiMatchNotReadyView(error: unknown) {
  if (!(error instanceof ApiClientError) || error.code !== "AI_MATCH_NOT_READY" || error.status !== 409) {
    return null;
  }
  const reason = typeof error.details.reason === "string" ? error.details.reason : "";
  return {
    reason,
    message: REASON_COPY[reason] ?? "Điểm phù hợp chưa sẵn sàng vì dữ liệu AI vẫn đang được xử lý.",
    actionLabel: "Thử lại ngay",
    pollDelayMs: AI_MATCH_POLL_DELAY_MS,
  };
}
