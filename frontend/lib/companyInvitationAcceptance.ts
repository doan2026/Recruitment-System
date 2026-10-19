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
  if (!length) return "Nhập mã lời mời.";
  if (length < 32) return "Mã lời mời phải có ít nhất 32 ký tự.";
  if (length > 128) return "Mã lời mời không được vượt quá 128 ký tự.";
  return null;
}

export function invitationFailureView(error: InvitationError): InvitationFailureView {
  switch (error.code) {
    case "INVITATION_NOT_FOUND":
      return {
        title: "Không tìm thấy lời mời",
        description: "Mã lời mời có thể bị nhập sai hoặc không còn tồn tại.",
        action: "RESET",
        actionLabel: "Kiểm tra mã lời mời khác",
      };
    case "INVITATION_EXPIRED":
      return {
        title: "Lời mời đã hết hạn",
        description: "Hãy liên hệ chủ sở hữu để được gửi mã lời mời mới.",
        action: "RESET",
        actionLabel: "Nhập mã được gửi lại",
      };
    case "INVITATION_REISSUE_REQUIRED":
      return {
        title: "Lời mời cần được phát lại",
        description: "Mã lời mời này không còn dùng được. Chủ sở hữu cần mời lại đúng email của bạn.",
        action: "RESET",
        actionLabel: "Nhập mã lời mời mới",
      };
    case "INVITATION_NOT_ACTIVE": {
      const invitationStatuses: Record<string, string> = { ACCEPTED: "Đã sử dụng", EXPIRED: "Đã hết hạn", REVOKED: "Đã thu hồi" };
      const invitationStatus = typeof error.details.status === "string"
        ? invitationStatuses[error.details.status] ?? "Không còn hiệu lực"
        : "Không còn hiệu lực";
      return {
        title: "Lời mời không còn hiệu lực",
        description: `Trạng thái hiện tại: ${invitationStatus}. Hãy liên hệ chủ sở hữu để tạo lời mời mới.`,
        action: "RESET",
        actionLabel: "Dùng lời mời mới",
      };
    }
    case "RECRUITER_ALREADY_HAS_COMPANY":
      return {
        title: "Bạn đã thuộc một công ty",
        description: "Mỗi nhà tuyển dụng chỉ có thể thuộc một công ty tại một thời điểm.",
        action: "OPEN_COMPANY",
        actionLabel: "Mở hồ sơ công ty",
      };
    case "INVITATION_EMAIL_MISMATCH":
      return {
        title: "Email tài khoản không khớp",
        description: "Hãy đăng nhập bằng đúng email mà chủ sở hữu đã mời.",
        action: "RESET",
        actionLabel: "Dùng mã lời mời cho tài khoản này",
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
        description: "Chỉ tài khoản nhà tuyển dụng hợp lệ mới có thể tham gia công ty.",
        action: "RESET",
        actionLabel: "Dùng tài khoản nhà tuyển dụng",
      };
    default:
      if (error.status === 401 || error.code === "AUTH_ACCOUNT_INVALID") {
        return {
          title: "Phiên đăng nhập không hợp lệ",
          description: "Đăng nhập lại bằng tài khoản nhà tuyển dụng rồi thử lại mã lời mời đang có.",
          action: "RETRY",
          actionLabel: "Thử lại sau khi đăng nhập",
        };
      }
      return {
        title: "Chưa nhận được lời mời",
        description: "Kết nối có thể đang gián đoạn. Mã lời mời vẫn được giữ trên màn hình này.",
        action: "RETRY",
        actionLabel: "Thử lại",
      };
  }
}
