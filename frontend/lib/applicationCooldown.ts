import { ApiClientError } from "./apiClientCore";

export interface ApplicationCooldownView {
  eligibleAt: string;
  eligibleAtLabel: string;
  title: string;
  description: string;
}

export function applicationCooldownView(error: unknown): ApplicationCooldownView | null {
  if (!(error instanceof ApiClientError) || error.status !== 409 || error.code !== "REAPPLICATION_COOLDOWN") {
    return null;
  }
  const eligibleAt = typeof error.details.eligibleAt === "string" ? error.details.eligibleAt : "";
  const timestamp = Date.parse(eligibleAt);
  if (!eligibleAt || Number.isNaN(timestamp)) return null;
  const eligibleAtLabel = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(timestamp);
  return {
    eligibleAt,
    eligibleAtLabel,
    title: "Chưa thể ứng tuyển lại",
    description: `Bạn có thể nộp lại từ ${eligibleAtLabel}. Đây là thời điểm kết thúc 30 ngày chờ sau lần bị từ chối gần nhất.`,
  };
}
