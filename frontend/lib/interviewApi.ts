import { requestApi } from "./apiClientCore";

export interface Interview {
  id: string;
  applicationId: string;
  roundNumber: number;
  scheduledStart: string;
  scheduledEnd: string;
  timeZone: string;
  durationMinutes: number;
  mode: "OFFLINE" | "ONLINE";
  location: string | null;
  status: string;
}
export interface InterviewPage { items: Interview[]; nextCursor: string | null }
export interface ScheduleInterview {
  applicationId: string; requestId: string; roundNumber: number;
  scheduledStart: string; timeZone: "Asia/Ho_Chi_Minh";
  durationMinutes: number; mode: "OFFLINE"; location: string; notes: string | null;
}

export function interviewStartGmt7(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Chọn ngày và giờ phỏng vấn hợp lệ.");
  const value = local + ":00+07:00";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())
    || new Date(parsed.getTime() + 7 * 3600000).toISOString().slice(0, 16) !== local) {
    throw new Error("Ngày và giờ phỏng vấn không hợp lệ.");
  }
  return value;
}

export function listMyInterviews(cursor: string | null, signal?: AbortSignal) {
  return requestApi<InterviewPage>("/interviews/my", {
    privateData: true, signal, query: { period: "ALL", limit: 20, cursor },
  });
}

export function scheduleInterview(body: ScheduleInterview) {
  // A retry reuses the requestId. Never silently repeat a scheduling mutation.
  return requestApi<Interview>("/interviews", { method: "POST", body, privateData: true, maxRetries: 0 });
}
