import { ApiClientError, requestApi, toUserMessage } from "./apiClient";
import {
  awaitSessionHydration,
  establishSession,
  type CurrentAccount,
  type LoginResponse,
} from "./authSession";
export const publicAuth = {
  privateData: true,
  authRecovery: false,
  attachAccessToken: false,
  maxRetries: 0,
} as const;
export function landing(role: CurrentAccount["role"]): string {
  return role === "ADMIN"
    ? "/admin"
    : role === "RECRUITER"
      ? "/recruiter/jobs"
      : "/candidate/profile";
}
export function loginRoute(role: CurrentAccount["role"]): string {
  return role === "ADMIN" ? "/admin/login" : role === "RECRUITER" ? "/recruiter/login" : "/login";
}
export function loginDestination(role: CurrentAccount["role"], returnTo: string | null): string {
  if (!returnTo?.startsWith("/") || returnTo.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(returnTo)) return landing(role);
  try {
    const url = new URL(returnTo, "https://careerhub.local");
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== "https://careerhub.local" || /[\\\u0000-\u001f\u007f]/.test(pathname) || /%2f|%5c|%25/i.test(url.pathname)) return landing(role);
    const prefix = role === "ADMIN" ? "/admin" : role === "RECRUITER" ? "/recruiter" : "/candidate";
    const shared = pathname === "/notifications"
      || (role !== "ADMIN" && (pathname === "/messages" || pathname === "/reports" || /^\/interviews\/[0-9a-f-]{36}\/room$/i.test(pathname)));
    const allowed = shared || pathname === prefix || pathname.startsWith(prefix + "/")
      || (role === "CANDIDATE" && (pathname === "/ai" || pathname.startsWith("/ai/")));
    if (!allowed || pathname === "/admin/login" || pathname === "/recruiter/login" || pathname === "/recruiter/register") return landing(role);
    return url.pathname + url.search + url.hash;
  } catch {
    return landing(role);
  }
}
export function passwordError(password: string): string | null {
  return Array.from(password).length < 8 ||
    !/\p{L}/u.test(password) ||
    !/\p{N}/u.test(password) ||
    new TextEncoder().encode(password).length > 72
    ? "Mật khẩu cần ít nhất 8 ký tự, có chữ và số, tối đa 72 byte."
    : null;
}
export function person1Error(error: unknown): string {
  if (error instanceof ApiClientError) {
    const messages: Record<string, string> = {
      EMAIL_ALREADY_REGISTERED:
        "Email đã đăng ký. Hãy đăng nhập hoặc đặt lại mật khẩu.",
      ACCOUNT_NOT_VERIFIED:
        "Tài khoản chưa xác minh. Hãy đăng ký lại để nhận mã xác minh mới.",
      OTP_INVALID: "Mã xác minh không đúng hoặc đã hết hạn.",
      OTP_EXPIRED: "Mã đã hết hạn. Hãy gửi lại mã.",
      ACCOUNT_LINK_REQUIRED:
        "Email này đã có tài khoản. Hãy đăng nhập bằng mật khẩu.",
      GOOGLE_OAUTH_DISABLED: "Đăng nhập Google chưa được cấu hình.",
      GOOGLE_ROLE_MISMATCH: "Tài khoản Google này thuộc vai trò khác. Hãy dùng đúng trang đăng nhập của tài khoản.",
      CV_VERSION_CONFLICT:
        "CV đã thay đổi. Tải lại danh sách trước khi thao tác tiếp.",
      REPORT_VERSION_CONFLICT: "Báo cáo đã được người khác xử lý. Hãy tải lại.",
      TAKEDOWN_CONTRACT_UNAVAILABLE:
        "Chức năng gỡ nội dung này chưa được kết nối. Báo cáo vẫn được giữ để xử lý.",
      UPSTREAM_UNAVAILABLE:
        "Dịch vụ đang gián đoạn. Kiểm tra lại trạng thái trước khi gửi lại thao tác.",
      ADMIN_UNAVAILABLE:
        "Chưa thể hoàn tất. Hãy kiểm tra nhật ký và trạng thái hiện tại trước khi thử lại.",
      UPSTREAM_REJECTED:
        "Thao tác không được chấp nhận. Tải lại dữ liệu để kiểm tra quyền và trạng thái.",
      INVALID_DATE_RANGE: "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.",
      CURRENT_EXPERIENCE_END_DATE: "Công việc hiện tại không có ngày kết thúc.",
      EXPERIENCE_END_DATE_REQUIRED: "Bổ sung ngày kết thúc hoặc chọn Đang làm việc.",
    };
    const message = messages[error.code] ?? toUserMessage(error);
    return error.retryAfterSeconds
      ? `${message} Thử lại sau ${error.retryAfterSeconds} giây.`
      : message;
  }
  return error instanceof Error ? error.message : "Chưa thể hoàn tất thao tác.";
}
export async function verifyRegistration(
  email: string,
  registrationId: string,
  otp: string,
) {
  await awaitSessionHydration();
  const result = await requestApi<LoginResponse>("/auth-cookie/verify", {
    ...publicAuth,
    method: "POST",
    body: { email, registrationId, otp },
  });
  return establishSession(result.data);
}
export async function exchangeGoogle(
  code: string,
  role: "CANDIDATE" | "RECRUITER",
) {
  await awaitSessionHydration();
  const result = await requestApi<LoginResponse>("/auth/google/exchange", {
    ...publicAuth,
    // The HttpOnly binder is scoped to this canonical path, not /api/auth/...
    fetcher: (_url, options) => fetch("/auth/google/exchange", options),
    method: "POST",
    body: { code, role },
  });
  return establishSession(result.data);
}
export const profileSectionLabels: Record<string, string> = {
  fullName: "Họ tên", headline: "Vị trí mong muốn", summary: "Giới thiệu",
  phone: "Điện thoại", address: "Địa chỉ", externalLinks: "Liên kết cá nhân",
  educations: "Học vấn", experiences: "Kinh nghiệm", skills: "Kỹ năng",
  certificates: "Chứng chỉ", projects: "Dự án",
};
export function profileDateError(block: string, draft: Record<string, unknown>): string | null {
  if (block !== "educations" && block !== "experiences") return null;
  if (block === "experiences" && !draft.isCurrent && !draft.endDate) {
    return "Bổ sung ngày kết thúc hoặc chọn Đang làm việc.";
  }
  if (draft.startDate && draft.endDate && String(draft.endDate) < String(draft.startDate)) {
    return "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.";
  }
  return null;
}
export interface ProfileBlock {
  id: string;
  [key: string]: string | number | boolean | null;
}
export interface CandidateProfile {
  userId: string;
  fullName: string | null;
  headline: string | null;
  summary: string | null;
  phone: string | null;
  address: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  avatarUrl: string | null;
  completionPercent: number;
  missingSections: string[];
  educations: ProfileBlock[];
  experiences: ProfileBlock[];
  skills: ProfileBlock[];
  certificates: ProfileBlock[];
  projects: ProfileBlock[];
}
export interface CandidateCv {
  id: string;
  title: string;
  type: "UPLOAD" | "ONLINE";
  isDefault: boolean;
  aggregateVersion: number;
  createdAt: string;
  templateId?: string;
  contentJson?: BuilderContent;
  revisionNumber: number;
}
export interface BuilderContent {
  fullName: string;
  headline: string;
  contact: string;
  summary: string;
  sections: { title: string; text: string }[];
}
interface UploadCapability {
  fileId: string;
  uploadUrl: string;
  apiKey: string;
  signature: string;
  expiresAt: string;
  maxBytes: number;
  allowedFormats: string[];
  params: Record<string, string | number>;
}
export function validatePersonalFile(
  file: Pick<File, "name" | "size">,
  type: "CV" | "AVATAR",
): void {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const allowed = type === "CV" ? ["pdf"] : ["jpg", "jpeg", "png", "webp"];
  if (
    !ext ||
    !allowed.includes(ext) ||
    file.size <= 0 ||
    file.size > (type === "CV" ? 5 : 2) * 1024 * 1024
  )
    throw new Error(
      type === "CV"
        ? "Chọn PDF không quá 5 MB."
        : "Chọn ảnh JPG, PNG, WEBP không quá 2 MB.",
    );
}
export function personalFileUploadError(status: number, payload: unknown): Error {
  const detail = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
  const message = detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string"
    ? detail.message.slice(0, 1000).toLowerCase() : "";
  // Classify only known provider failures; never display its raw response,
  // which can include account identifiers, URLs or signed parameters.
  if (status === 401 || status === 403
    || (/upload preset/.test(message) && /not found|does not exist|invalid|unknown/.test(message))
    || /invalid signature|invalid api.?key|unknown api.?key/.test(message)) {
    return new Error("Dịch vụ lưu trữ chưa được cấu hình đầy đủ. Vui lòng liên hệ quản trị viên để hoàn tất cấu hình tải tệp.");
  }
  if (status === 413 || /file size too large|maximum file size/.test(message)) {
    return new Error("Kho lưu trữ từ chối vì tệp vượt quá dung lượng cho phép. Hãy chọn tệp nhỏ hơn.");
  }
  if (status === 429 || status >= 500) {
    return new Error("Dịch vụ lưu trữ đang bận hoặc gián đoạn. Vui lòng thử tải tệp lại sau.");
  }
  return new Error("Kho lưu trữ từ chối tệp. Kiểm tra định dạng và dung lượng trước khi thử lại.");
}
export async function uploadPersonalFile(
  file: File,
  type: "CV" | "AVATAR",
  signal?: AbortSignal,
): Promise<string> {
  validatePersonalFile(file, type);
  if (
    type === "CV" &&
    new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== "%PDF-"
  )
    throw new Error("Nội dung tệp không phải PDF.");
  const result = await requestApi<UploadCapability>("/files/signature", {
    method: "POST",
    privateData: true,
    signal,
    headers: { "Idempotency-Key": `personal-${crypto.randomUUID()}` },
    body: { type, originalFilename: file.name },
  });
  const cap = result.data;
  const url = new URL(cap.uploadUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.cloudinary.com" ||
    !Number.isFinite(Date.parse(cap.expiresAt)) ||
    Date.parse(cap.expiresAt) <= Date.now() ||
    file.size > cap.maxBytes
  )
    throw new Error("Thông tin tải tệp không hợp lệ hoặc đã hết hạn.");
  const form = new FormData();
  form.append("file", file, file.name);
  Object.entries(cap.params).forEach(([key, value]) =>
    form.append(key, String(value)),
  );
  form.append("api_key", cap.apiKey);
  form.append("signature", cap.signature);
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 60_000);
  try {
    if (signal?.aborted) cancel();
    const uploaded = await fetch(cap.uploadUrl, {
      method: "POST",
      body: form,
      credentials: "omit",
      redirect: "error",
      signal: abort.signal,
    });
    if (!uploaded.ok) {
      const payload: unknown = await uploaded.json().catch(() => null);
      throw personalFileUploadError(uploaded.status, payload);
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
  await requestApi("/files/", {
    method: "POST",
    privateData: true,
    body: { fileId: cap.fileId },
    signal,
  });
  return cap.fileId;
}
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Keep native constraints while rendering errors in the product's inline alert. */
export function person1FormError(form: HTMLFormElement): string | null {
  for (const field of Array.from(form.elements)) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) || field.disabled) continue;
    const label = field.labels?.[0]?.textContent?.trim().replace(/\s+/g, " ").replace(/\s*\*$/, "") || "Thông tin";
    let problem = "";
    if (field.required && !field.value.trim()) problem = "Vui lòng bổ sung thông tin.";
    else if (field.validity.typeMismatch) problem = field instanceof HTMLInputElement && field.type === "email" ? "Nhập email hợp lệ." : "Nhập liên kết hợp lệ.";
    else if (field.validity.patternMismatch || field.validity.badInput) problem = "Kiểm tra lại định dạng.";
    else if (field.validity.rangeUnderflow || field.validity.rangeOverflow) problem = "Giá trị nằm ngoài khoảng cho phép.";
    else if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      if (field.minLength > 0 && field.value && field.value.trim().length < field.minLength) problem = `Cần ít nhất ${field.minLength} ký tự.`;
      else if (field.maxLength >= 0 && field.value.length > field.maxLength) problem = `Chỉ nhập tối đa ${field.maxLength} ký tự.`;
    }
    if (problem) { field.focus(); return `${label}: ${problem}`; }
  }
  return null;
}
