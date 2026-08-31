export type CandidateRecommendationEmptyReason =
  | "NO_DISCOVERABLE_CANDIDATES"
  | "JOB_EMBEDDING_NOT_FOUND"
  | "JOB_EMBEDDING_INACTIVE"
  | "NO_ACTIVE_CV_EMBEDDINGS"
  | "EMBEDDING_MODEL_MISMATCH"
  | "NO_MATCHING_CV_EMBEDDINGS";

export interface CandidateRecommendationEmptyView {
  title: string;
  description: string;
  actionLabel: string;
  action: "RETRY" | "EDIT_JOB";
}

export function candidateRecommendationEmptyView(
  reason: CandidateRecommendationEmptyReason,
): CandidateRecommendationEmptyView {
  switch (reason) {
    case "NO_DISCOVERABLE_CANDIDATES":
      return {
        title: "Chưa có ứng viên cho phép khám phá",
        description: "Chỉ ứng viên đã bật consent khám phá ở Profile Service mới xuất hiện. Nhà tuyển dụng không thể tự thay đổi quyền này.",
        actionLabel: "Kiểm tra lại danh sách",
        action: "RETRY",
      };
    case "JOB_EMBEDDING_NOT_FOUND":
      return {
        title: "Tin tuyển dụng chưa được vector hóa",
        description: "Dữ liệu AI của tin có thể vẫn đang được tạo sau khi tin được duyệt.",
        actionLabel: "Kiểm tra lại dữ liệu tin",
        action: "RETRY",
      };
    case "JOB_EMBEDDING_INACTIVE":
      return {
        title: "Vector của tin chưa hoạt động",
        description: "Hệ thống đang đồng bộ lại phiên bản mới nhất của tin tuyển dụng.",
        actionLabel: "Chờ đồng bộ rồi thử lại",
        action: "RETRY",
      };
    case "NO_ACTIVE_CV_EMBEDDINGS":
      return {
        title: "Chưa có CV đang hoạt động trong tập khám phá",
        description: "Ứng viên có thể đã consent nhưng chưa có CV active được xử lý thành embedding.",
        actionLabel: "Làm mới tập ứng viên",
        action: "RETRY",
      };
    case "EMBEDDING_MODEL_MISMATCH":
      return {
        title: "Dữ liệu đang được nâng cấp mô hình",
        description: "Embedding của tin và CV chưa cùng phiên bản model nên hệ thống không xếp hạng sai lệch.",
        actionLabel: "Kiểm tra sau khi đồng bộ",
        action: "RETRY",
      };
    case "NO_MATCHING_CV_EMBEDDINGS":
      return {
        title: "Chưa có CV phù hợp với tiêu chí hiện tại",
        description: "Tập ứng viên hợp lệ đã được kiểm tra nhưng chưa có kết quả đủ điều kiện xếp hạng.",
        actionLabel: "Điều chỉnh nội dung tin",
        action: "EDIT_JOB",
      };
  }
}
