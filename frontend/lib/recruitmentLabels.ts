const jobStatuses: Record<string, string> = {
  DRAFT: "Bản nháp",
  PENDING_APPROVAL: "Chờ duyệt",
  PUBLISHED: "Đang tuyển",
  CLOSED: "Đã đóng",
  EXPIRED: "Hết hạn",
};

const applicationStatuses: Record<string, string> = {
  APPLIED: "Đã ứng tuyển",
  REVIEWING: "Đang xem xét",
  INTERVIEW: "Phỏng vấn",
  OFFER: "Chờ phản hồi thư mời",
  HIRED: "Đã tuyển",
  REJECTED: "Đã từ chối",
  WITHDRAWN: "Đã rút hồ sơ",
};

const offerStatuses: Record<string, string> = {
  PENDING_CANDIDATE_RESPONSE: "Chờ phản hồi",
  SENT: "Đã gửi",
  ACCEPTED: "Đã chấp nhận",
  DECLINED: "Đã từ chối",
  EXPIRED: "Hết hạn",
  CANCELLED: "Đã thu hồi",
};

const jobTypes: Record<string, string> = {
  FULLTIME: "Toàn thời gian",
  FULL_TIME: "Toàn thời gian",
  PARTTIME: "Bán thời gian",
  PART_TIME: "Bán thời gian",
  REMOTE: "Làm việc từ xa",
  INTERNSHIP: "Thực tập",
  CONTRACT: "Hợp đồng",
};

export function jobStatusLabel(status: string): string {
  return jobStatuses[status] ?? status;
}

export function applicationStatusLabel(status: string): string {
  return applicationStatuses[status] ?? status;
}

export function offerStatusLabel(status: string): string {
  return offerStatuses[status] ?? status;
}

export function jobTypeLabel(type: string): string {
  return jobTypes[type] ?? type;
}

export function companyMemberRoleLabel(role: "OWNER" | "MEMBER" | null | undefined): string {
  return role === "OWNER" ? "Chủ sở hữu" : role === "MEMBER" ? "Thành viên" : "Đang xác định";
}
