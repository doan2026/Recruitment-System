import { ApiClientError, requestApi, toUserMessage } from "./apiClientCore";

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

export function interviewStatusLabel(status: string): string {
  return ({ SCHEDULED: "Đã lên lịch", CONFIRMED: "Đã xác nhận", IN_PROGRESS: "Đang phỏng vấn", COMPLETED: "Đã hoàn thành", RESCHEDULE_REQUESTED: "Đề nghị đổi lịch", CANCELLED: "Đã hủy", NO_SHOW: "Vắng mặt" } as Record<string, string>)[status] ?? "Đang cập nhật";
}

export function schedulingRequestIdentity(previous: { fingerprint: string; id: string } | null, payload: Omit<ScheduleInterview, "requestId">, createId: () => string): { fingerprint: string; id: string } {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, id: createId() };
}

export function interviewScheduleError(error: unknown): string {
  if (error instanceof ApiClientError) {
    const messages: Record<string, string> = {
      INTERVIEW_CANDIDATE_CONFLICT: "Ứng viên đã có lịch trùng giờ. Hãy chọn thời gian khác.",
      INTERVIEW_INTERVIEWER_CONFLICT: "Bạn đã có lịch phỏng vấn trùng giờ. Hãy chọn thời gian khác.",
      INTERVIEW_SCHEDULE_CONFLICT: "Khung giờ vừa được sử dụng. Hãy kiểm tra lịch và chọn thời gian khác.",
      INTERVIEW_ROUND_ALREADY_SCHEDULED: "Vòng phỏng vấn này đã có lịch. Hãy kiểm tra trước khi tạo vòng tiếp theo.",
      INTERVIEW_IDEMPOTENCY_CONFLICT: "Nội dung lịch đã thay đổi. Hãy kiểm tra thông tin rồi gửi lại.",
      APPLICATION_NOT_ELIGIBLE_FOR_INTERVIEW: "Trạng thái hồ sơ đã thay đổi. Hãy quay về hồ sơ và kiểm tra lại.",
    };
    return messages[error.code] ?? toUserMessage(error);
  }
  return error instanceof Error ? error.message : toUserMessage(error);
}
