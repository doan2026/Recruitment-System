import { ApiClientError, requestApi, toUserMessage } from "./apiClient";
import {
  establishSession,
  type CurrentAccount,
  type TokenResponse,
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
    const allowed = pathname === prefix || pathname.startsWith(prefix + "/")
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
      INVALID_DATE_RANGE: "Chọn khoảng thời gian hợp lệ, tối đa 367 ngày.",
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
  const result = await requestApi<TokenResponse>("/auth/otp/verify", {
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
  const result = await requestApi<TokenResponse>("/auth/google/exchange", {
    ...publicAuth,
    // The HttpOnly binder is scoped to this canonical path, not /api/auth/...
    fetcher: (_url, options) => fetch("/auth/google/exchange", options),
    method: "POST",
    body: { code, role },
  });
  return establishSession(result.data);
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
    if (!uploaded.ok) throw new Error("Tải tệp thất bại. Hãy thử lại.");
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
