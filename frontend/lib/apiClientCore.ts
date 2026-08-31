export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  source?: string;
  cursor?: string | null;
  hasMore?: boolean;
  nextCursor?: string | null;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta | null;
}

export interface ApiErrorPayload {
  code: string;
  message?: string;
  details?: Record<string, unknown> | null;
}

export type RecoveryKind =
  | "none"
  | "retry"
  | "retry-after"
  | "reload"
  | "reload-compare"
  | "restart-list"
  | "reauthenticate";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly retryAfterSeconds: number | null;
  readonly recovery: RecoveryKind;

  constructor({
    code,
    status = 0,
    details,
    retryAfterSeconds = null,
  }: {
    code: string;
    status?: number;
    details?: Record<string, unknown> | null;
    retryAfterSeconds?: number | null;
  }) {
    super(normalizeError(code));
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details ?? {};
    this.retryAfterSeconds = retryAfterSeconds;
    this.recovery = recoveryFor(code, status);
  }
}

export const API_PATHS = Object.freeze({
  companies: "/companies/",
  companyMine: "/companies/me",
  companySearch: "/companies/search",
  jobs: "/jobs/",
  jobMine: "/jobs/mine",
  jobSearch: "/jobs/search",
  jobRecommended: "/jobs/recommended",
  applications: "/applications/",
  applicationMine: "/applications/my",
  bookmarks: "/applications/bookmarks",
  offers: "/offers/",
  aiChat: "/ai/chat",
});

type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | QueryPrimitive[] | null | undefined;

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  allowedQueryKeys?: readonly string[];
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  privateData?: boolean;
  maxRetries?: number;
  fetcher?: typeof fetch;
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRANSIENT_STATUSES = new Set([429, 503]);
const SAFE_RETRY_METHODS = new Set(["GET"]);
const MAX_RETRY_DELAY_MS = 2_000;

let accessToken: string | null = null;
let sessionAccountId: string | null = null;
let sessionRevision = 0;
const sessionListeners = new Set<(revision: number) => void>();

export interface ApiSessionRefreshResult {
  token?: string | null;
  accountId: string;
}

export type ApiSessionRefresher = () => Promise<ApiSessionRefreshResult | null>;

let sessionRefresher: ApiSessionRefresher | null = null;
let sessionRefreshFlight: Promise<boolean> | null = null;

function publishSessionRevision(): void {
  sessionRevision += 1;
  sessionListeners.forEach((listener) => listener(sessionRevision));
}

export function setApiSession({
  token,
  accountId,
}: { token?: string | null; accountId: string }): void {
  const normalizedToken = token?.trim() || null;
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) {
    throw new ApiClientError({ code: "SESSION_ACCOUNT_REQUIRED" });
  }

  const identityChanged = normalizedAccountId !== sessionAccountId;
  accessToken = normalizedToken;
  sessionAccountId = normalizedAccountId;
  if (identityChanged) publishSessionRevision();
}

/**
 * Compatibility path when Auth cannot provide a stable account id yet.
 * Every credential change invalidates protected UI state; prefer setApiSession
 * to avoid clearing state during a same-account token refresh.
 */
export function setApiAccessToken(token: string | null): void {
  const normalized = token?.trim() || null;
  if (normalized === accessToken) return;
  accessToken = normalized;
  sessionAccountId = null;
  publishSessionRevision();
}

export function clearApiSession(): void {
  accessToken = null;
  sessionAccountId = null;
  publishSessionRevision();
}

export function subscribeToApiSession(listener: (revision: number) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function getApiSessionRevision(): number {
  return sessionRevision;
}

export function getApiSessionAccountId(): string | null {
  return sessionAccountId;
}

export function configureApiSessionRefresh(refresher: ApiSessionRefresher | null): void {
  sessionRefresher = refresher;
}

async function refreshApiSession(expectedAccountId: string | null): Promise<boolean> {
  if (!sessionRefresher) return false;
  if (!sessionRefreshFlight) {
    sessionRefreshFlight = (async () => {
      try {
        const refreshed = await sessionRefresher?.();
        const accountId = refreshed?.accountId.trim() ?? "";
        if (!refreshed || !accountId || (expectedAccountId !== null && accountId !== expectedAccountId)) return false;
        setApiSession({ token: refreshed.token, accountId });
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      sessionRefreshFlight = null;
    });
  }
  return sessionRefreshFlight;
}

export function isCanonicalUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

export function assertCanonicalUuidV4(value: string, field = "id"): string {
  if (!isCanonicalUuidV4(value)) {
    throw new ApiClientError({
      code: "INVALID_UUID_V4",
      status: 422,
      details: { field },
    });
  }
  return value;
}

export function createChatSessionId(randomUuid?: () => string): string {
  const value = (randomUuid?.() ?? globalThis.crypto?.randomUUID?.())?.toLowerCase();
  if (!value) throw new ApiClientError({ code: "UUID_GENERATION_UNAVAILABLE" });
  return assertCanonicalUuidV4(value, "session_id");
}

export function collectionPath(path: string): string {
  if (!path.startsWith("/")) throw new ApiClientError({ code: "INVALID_API_PATH" });
  return path.endsWith("/") ? path : `${path}/`;
}

export function selectContractFields<T extends Record<string, unknown>>(
  input: T,
  allowedFields: readonly string[],
): Partial<T> {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new ApiClientError({
      code: "UNKNOWN_REQUEST_FIELD",
      status: 422,
      details: { fields: unknown },
    });
  }
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function buildQuery(
  query: Record<string, QueryValue> = {},
  allowedKeys: readonly string[] = Object.keys(query),
): string {
  const selected = selectContractFields(query, allowedKeys);
  const params = new URLSearchParams();
  Object.entries(selected).forEach(([key, rawValue]) => {
    if (rawValue === undefined || rawValue === null || rawValue === "") return;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    values.forEach((value) => params.append(key, String(value)));
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1_000));
}

export function recoveryFor(code: string, status = 0): RecoveryKind {
  if (code === "JOB_SEARCH_CURSOR_STALE" || code === "RECOMMENDATION_CURSOR_STALE") return "restart-list";
  if (
    code === "COMPANY_UPDATE_CONFLICT" ||
    code === "APPLICATION_CHANGED_CONCURRENTLY" ||
    code === "JOB_STATE_CHANGED" ||
    code.includes("CHANGED_CONCURRENTLY")
  ) return "reload-compare";
  if (status === 401) return "reauthenticate";
  if (status === 429) return "retry-after";
  if (status === 503 || code === "TIMEOUT" || code === "NETWORK_ERROR") return "retry";
  if (status === 409) return "reload";
  return "none";
}

export function normalizeError(code: string): string {
  const messages: Record<string, string> = {
    TIMEOUT: "Máy chủ phản hồi quá lâu. Hãy thử lại.",
    REQUEST_CANCELLED: "Yêu cầu đã được hủy.",
    NETWORK_ERROR: "Không thể kết nối máy chủ. Kiểm tra mạng rồi thử lại.",
    INVALID_API_RESPONSE: "Máy chủ trả dữ liệu không hợp lệ. Hãy thử lại sau.",
    INVALID_API_PATH: "Đường dẫn API không hợp lệ.",
    API_BASE_URL_REQUIRED: "Thiếu cấu hình địa chỉ API Gateway cho server.",
    INVALID_UUID_V4: "Mã định danh không đúng định dạng UUID v4.",
    INVALID_EXPECTED_VERSION: "Phiên bản dữ liệu không hợp lệ. Hãy tải lại trước khi tiếp tục.",
    UUID_GENERATION_UNAVAILABLE: "Không thể tạo phiên trò chuyện an toàn trên trình duyệt này.",
    CHAT_SESSION_BUSY: "Phiên trò chuyện đang xử lý một tin nhắn khác.",
    CHAT_RATE_LIMITED: "Bạn đã gửi quá nhiều tin nhắn. Hãy chờ trước khi thử lại.",
    CHAT_BUSY: "Trợ lý đang bận. Hãy thử lại sau ít phút.",
    CHAT_PROVIDER_UNAVAILABLE: "Nhà cung cấp trợ lý đang tạm gián đoạn. Hãy chủ động thử lại.",
    CHAT_HISTORY_UNAVAILABLE: "Lịch sử hội thoại đang tạm gián đoạn. Hãy chủ động thử lại.",
    CHAT_NOT_CONFIGURED: "Trợ lý nghề nghiệp chưa được bật trong môi trường này.",
    CHAT_ACCESS_FORBIDDEN: "Trợ lý nghề nghiệp chỉ dành cho tài khoản ứng viên.",
    SESSION_ACCOUNT_REQUIRED: "Không thể thiết lập phiên vì thiếu định danh tài khoản.",
    UNKNOWN_REQUEST_FIELD: "Dữ liệu gửi đi chứa trường không được API hỗ trợ.",
    JOB_SEARCH_CURSOR_STALE: "Danh sách việc làm đã thay đổi. Hãy tải lại từ đầu.",
    COMPANY_NOT_FOUND: "Tài khoản này chưa có hồ sơ công ty.",
    RECRUITER_ALREADY_HAS_COMPANY: "Tài khoản đã thuộc một công ty. Hãy mở hồ sơ hiện có.",
    INVALID_RESUBMISSION_TRANSITION: "Trạng thái xác minh đã thay đổi. Hãy xem dữ liệu mới nhất.",
    COMPANY_OWNER_REQUIRED: "Chỉ chủ sở hữu công ty có thể thực hiện thao tác này.",
    RECOMMENDATION_CURSOR_STALE: "Danh sách gợi ý đã thay đổi. Hãy tải lại từ đầu.",
    COMPANY_UPDATE_CONFLICT: "Dữ liệu công ty vừa được người khác sửa. Hãy tải lại và so sánh thay đổi.",
    OFFER_EXPIRED: "Offer đã hết hạn. Hãy liên hệ nhà tuyển dụng.",
    OFFER_ALREADY_RESPONDED: "Offer này đã được phản hồi.",
    OFFER_CHANGED_CONCURRENTLY: "Offer vừa được cập nhật. Hãy tải lại trước khi phản hồi.",
    APPLICATION_CHANGED_CONCURRENTLY: "Hồ sơ vừa thay đổi. Hãy tải lại trước khi tiếp tục.",
    INVALID_EVALUATION_SCORE: "Điểm đánh giá phải từ 0 đến 100 và có tối đa 2 chữ số thập phân.",
    INVALID_EVALUATION_NOTE: "Ghi chú đánh giá không được vượt quá 2.000 ký tự.",
    EVALUATION_ALREADY_EXISTS: "Bạn đã đánh giá hồ sơ này.",
    INVALID_APPLICATION_TRANSITION: "Trạng thái hồ sơ đã thay đổi hoặc thao tác này không còn hợp lệ. Hãy tải lại pipeline.",
    REAPPLICATION_COOLDOWN: "Bạn đang trong thời gian chờ trước khi có thể ứng tuyển lại.",
    JOB_STATE_CHANGED: "Trạng thái tin tuyển dụng vừa thay đổi. Hãy tải lại và so sánh trước khi tiếp tục.",
    JOB_ACCESS_DENIED: "Bạn không có quyền thao tác với tin tuyển dụng này. Danh sách sẽ được đồng bộ lại.",
    JOB_SEARCH_PAGE_TOO_DEEP: "Kết quả quá sâu. Hãy lọc hẹp hơn hoặc chuyển sang tải thêm.",
    MEDIA_UPLOAD_RATE_LIMITED: "Bạn tải file quá nhiều lần. Hãy chờ rồi thử lại.",
    MEDIA_PROVIDER_UPLOAD_FAILED: "Nhà cung cấp chưa nhận file. Hãy xin chữ ký mới rồi thử lại.",
    MEDIA_UPLOAD_POLICY_MISMATCH: "File không khớp chính sách tải lên hiện tại. Hãy chọn lại file.",
    COMPANY_MEDIA_UPLOAD_INTENT_INVALID: "Phiên tải media không còn hợp lệ. Hãy xin chữ ký mới.",
    COMPANY_MEDIA_UPLOAD_INTENT_CONFLICT: "Phiên tải media đã thay đổi. Hãy chọn lại file và xin chữ ký mới.",
    COMPANY_MEDIA_UPLOAD_CONFIRM_CONFLICT: "Trạng thái file đã thay đổi. Hãy tải lại hồ sơ trước khi tiếp tục.",
    OFFER_READ_UNAVAILABLE: "Offer chỉ được mở từ thông báo vì Application API chưa có endpoint đọc offer.",
  };
  return messages[code] ?? "Không thể hoàn tất yêu cầu. Hãy thử lại.";
}

export function toUserMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : normalizeError("NETWORK_ERROR");
}

export function toNoStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store", Pragma: "no-cache" };
}

function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";
  if (!configured && typeof window === "undefined") {
    throw new ApiClientError({ code: "API_BASE_URL_REQUIRED" });
  }
  return configured.replace(/\/$/, "");
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return !!value && typeof value === "object" && "data" in value;
}

function asErrorPayload(value: unknown, status: number): ApiErrorPayload {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? record.code : `HTTP_${status}`,
      message: typeof record.message === "string" ? record.message : undefined,
      details: record.details && typeof record.details === "object"
        ? record.details as Record<string, unknown>
        : null,
    };
  }
  return { code: `HTTP_${status}` };
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function requestApi<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiEnvelope<T>> {
  if (!path.startsWith("/")) throw new ApiClientError({ code: "INVALID_API_PATH" });
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancelFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
  if (options.signal?.aborted) controller.abort();

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.privateData) {
    Object.entries(toNoStoreHeaders()).forEach(([key, value]) => headers.set(key, value));
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const query = buildQuery(options.query, options.allowedQueryKeys);
  const url = `${apiBaseUrl()}${path}${query}`;
  const fetcher = options.fetcher ?? fetch;
  const maxRetries = options.maxRetries ?? (SAFE_RETRY_METHODS.has(method) ? 1 : 0);

  let transientAttempt = 0;
  let authRefreshAttempted = false;
  const requestAccountId = sessionAccountId;

  try {
    for (;;) {
      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          headers,
          credentials: "include",
          cache: options.privateData ? "no-store" : "default",
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new ApiClientError({ code: timedOut ? "TIMEOUT" : "REQUEST_CANCELLED" });
        }
        throw new ApiClientError({ code: "NETWORK_ERROR" });
      }

      const payload = await readPayload(response);
      if (response.ok) {
        if (!isEnvelope(payload)) {
          throw new ApiClientError({ code: "INVALID_API_RESPONSE", status: response.status });
        }
        return {
          data: payload.data as T,
          meta: payload.meta && typeof payload.meta === "object" ? payload.meta as ApiMeta : null,
        };
      }

      const errorPayload = asErrorPayload(payload, response.status);
      const detailsRetry = Number(errorPayload.details?.retryAfterSeconds);
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"))
        ?? (Number.isFinite(detailsRetry) && detailsRetry >= 0 ? Math.ceil(detailsRetry) : null);
      const apiError = new ApiClientError({
        code: errorPayload.code,
        status: response.status,
        details: errorPayload.details,
        retryAfterSeconds,
      });
      if (response.status === 401) {
        if (options.privateData && !authRefreshAttempted) {
          authRefreshAttempted = true;
          if (await refreshApiSession(requestAccountId)) {
            if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
            else headers.delete("Authorization");
            continue;
          }
        }
        clearApiSession();
        throw apiError;
      }
      if (!TRANSIENT_STATUSES.has(response.status) || transientAttempt >= maxRetries) throw apiError;
      if (retryAfterSeconds !== null && retryAfterSeconds * 1_000 > MAX_RETRY_DELAY_MS) {
        throw apiError;
      }

      const backoffMs = retryAfterSeconds === null
        ? Math.min(250 * (2 ** transientAttempt), MAX_RETRY_DELAY_MS)
        : retryAfterSeconds * 1_000;
      try {
        await delay(backoffMs, controller.signal);
      } catch {
        throw new ApiClientError({ code: timedOut ? "TIMEOUT" : "REQUEST_CANCELLED" });
      }
      transientAttempt += 1;
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancelFromCaller);
  }
}
