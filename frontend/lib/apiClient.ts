import type { ApiError, ApiEnvelope } from "./demoData";

export interface SuccessEnvelope<T> {
  data: T;
  meta?: ApiEnvelope<T>["meta"];
}

export type ApiResponse<T> = SuccessEnvelope<T> | ApiError;

export interface HttpEnvelopeOptions {
  timeoutMs?: number;
}

export async function requestEnvelope<T>(
  call: () => Promise<ApiResponse<T>>,
  options?: HttpEnvelopeOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const timeout = new Promise<ApiResponse<T>>((resolve) =>
    setTimeout(() => resolve({ code: "TIMEOUT", message: "Request timeout", details: { reason: "TIMEOUT" } }), timeoutMs),
  );

  const result = await Promise.race([call(), timeout]);

  if ((result as ApiError).code) {
    const err = result as ApiError;
    const parsed = new Error(err.message);
    (parsed as Error & { code?: string; details?: ApiError["details"] }).code = err.code;
    (parsed as Error & { code?: string; details?: ApiError["details"] }).details = err.details;
    throw parsed;
  }

  return (result as ApiResponse<T> as SuccessEnvelope<T>).data;
}

export function toNoStoreHeaders() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
  };
}

export function normalizeError(code: string): string {
  switch (code) {
    case "CURSOR_STALE":
    case "JOB_SEARCH_CURSOR_STALE":
    case "RECOMMENDATION_CURSOR_STALE":
      return "Danh sách cần làm mới để tiếp tục nạp tiếp.";
    case "MEDIA_UPLOAD_RATE_LIMITED":
      return "Tải file đang quá nhiều lần, hãy thử lại sau giây lát.";
    default:
      return "Có lỗi từ server. Vui lòng thử lại.";
  }
}
