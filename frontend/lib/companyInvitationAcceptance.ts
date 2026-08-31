import type { ApiClientError } from "./apiClientCore";

export type InvitationFailureAction = "RESET" | "RETRY" | "OPEN_COMPANY";

export interface InvitationFailureView {
  title: string;
  description: string;
  action: InvitationFailureAction;
  actionLabel: string;
}

type InvitationError = Pick<ApiClientError, "code" | "status" | "details">;

export function validateInvitationToken(value: string): string | null {
  const length = value.trim().length;
  if (!length) return "Nhập token lời mời.";
  if (length < 32) return "Token phải có ít nhất 32 ký tự.";
  if (length > 128) return "Token không được vượt quá 128 ký tự.";
  return null;
}

export function invitationFailureView(error: InvitationError): InvitationFailureView {
  switch (error.code) {
    case "INVITATION_NOT_FOUND":
      return {
        title: "Không tìm thấy lời mời",
        description: "Token có thể bị nhập sai hoặc không còn tồn tại.",
        action: "RESET",
        actionLabel: "Kiểm tra token khác",
      };
    case "INVITATION_EXPIRED":
      return {
        title: "Lời mời đã hết hạn",
        description: "Hãy liên hệ OWNER để được phát hành một token mới.",
        action: "RESET",
        actionLabel: "Nhập token được phát lại",
      };
    case "INVITATION_REISSUE_REQUIRED":
      return {
        title: "Lời mời cần được phát lại",
        description: "Token này dùng chuẩn cũ. OWNER cần mời lại đúng email của bạn.",
        action: "RESET",
        actionLabel: "Nhập token mới",
      };
    case "INVITATION_NOT_ACTIVE": {
      const invitationStatus = typeof error.details.status === "string"
        ? error.details.status
        : "không còn hiệu lực";
      return {
        title: "Lời mời không còn hiệu lực",
        description: `Trạng thái hiện tại: ${invitationStatus}. Hãy xin OWNER tạo lời mời mới.`,
        action: "RESET",
        actionLabel: "Dùng lời mời mới",
      };
    }
    case "RECRUITER_ALREADY_HAS_COMPANY":
      return {
        title: "Bạn đã thuộc một công ty",
        description: "Mỗi Recruiter chỉ có thể thuộc một công ty tại một thời điểm.",
        action: "OPEN_COMPANY",
        actionLabel: "Mở hồ sơ công ty",
      };
    case "INVITATION_EMAIL_MISMATCH":
      return {
        title: "Email tài khoản không khớp",
        description: "Hãy đăng nhập bằng đúng email mà OWNER đã mời.",
        action: "RESET",
        actionLabel: "Dùng token cho tài khoản này",
      };
    case "AUTH_ACCOUNT_INACTIVE":
      return {
        title: "Tài khoản đang bị vô hiệu hóa",
        description: "Liên hệ quản trị viên để kích hoạt tài khoản trước khi nhận lời mời.",
        action: "RESET",
        actionLabel: "Kiểm tra bằng tài khoản khác",
      };
    case "INVITATION_ACCEPTANCE_FORBIDDEN":
      return {
        title: "Tài khoản không thể nhận lời mời",
        description: "Chỉ tài khoản Recruiter hợp lệ mới có thể tham gia công ty.",
        action: "RESET",
        actionLabel: "Dùng tài khoản Recruiter",
      };
    default:
      if (error.status === 401 || error.code === "AUTH_ACCOUNT_INVALID") {
        return {
          title: "Phiên đăng nhập không hợp lệ",
          description: "Đăng nhập lại bằng tài khoản Recruiter rồi thử lại token đang có.",
          action: "RETRY",
          actionLabel: "Thử lại sau khi đăng nhập",
        };
      }
      return {
        title: "Chưa nhận được lời mời",
        description: "Kết nối có thể đang gián đoạn. Token vẫn được giữ trên màn hình này.",
        action: "RETRY",
        actionLabel: "Thử lại",
      };
  }
}
