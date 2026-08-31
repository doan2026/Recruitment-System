import { ApiClientError } from "./apiClientCore";

export type OfferResponseRecoveryAction =
  | { kind: "LINK"; label: string; href: string }
  | { kind: "RELOAD"; label: string };

export interface OfferResponseRecoveryView {
  title: string;
  description: string;
  action: OfferResponseRecoveryAction;
}

const RECOVERY_BY_CODE: Record<string, OfferResponseRecoveryView> = {
  OFFER_EXPIRED: {
    title: "Offer đã hết hạn",
    description: "Thời hạn phản hồi đã qua nên hệ thống không thể ghi nhận quyết định này.",
    action: { kind: "LINK", label: "Tìm cơ hội khác", href: "/candidate/jobs" },
  },
  OFFER_ALREADY_RESPONDED: {
    title: "Offer đã được phản hồi",
    description: "Một quyết định đã được ghi nhận trước đó. Hãy xem trạng thái hồ sơ hiện tại.",
    action: { kind: "LINK", label: "Xem hồ sơ đã cập nhật", href: "/candidate/applications" },
  },
  OFFER_CHANGED_CONCURRENTLY: {
    title: "Nội dung Offer vừa thay đổi",
    description: "Phiên bản Offer bạn đang xem không còn mới nhất. Không gửi lại quyết định trên dữ liệu cũ.",
    action: { kind: "RELOAD", label: "Tải lại Offer mới nhất" },
  },
  APPLICATION_CHANGED_CONCURRENTLY: {
    title: "Hồ sơ ứng tuyển vừa thay đổi",
    description: "Trạng thái hồ sơ không còn khớp với Offer này. Hãy kiểm tra pipeline trước khi quyết định.",
    action: { kind: "LINK", label: "Kiểm tra trạng thái hồ sơ", href: "/candidate/applications" },
  },
};

export function offerResponseRecoveryView(error: unknown): OfferResponseRecoveryView | null {
  if (!(error instanceof ApiClientError) || error.status !== 409) return null;
  return RECOVERY_BY_CODE[error.code] ?? null;
}
