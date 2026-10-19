import type { FallbackReason, JobDataSource, RecommendationSource } from "./demoData";

export interface DataSourceView {
  label: string;
  description: string;
  tone: "success" | "info" | "warning";
}

export interface RecommendationFallbackView {
  title: string;
  description: string;
  actionLabel: string;
  action: "UPLOAD_CV" | "RETRY";
}

export function jobDataSourceView(source: JobDataSource): DataSourceView {
  return source === "ELASTICSEARCH"
    ? { label: "Chỉ mục tìm kiếm", description: "Kết quả từ chỉ mục tìm kiếm tối ưu.", tone: "success" }
    : { label: "Dữ liệu trực tiếp", description: "Đang hiển thị tin tuyển dụng trực tiếp khi tìm kiếm tạm thời chưa sẵn sàng.", tone: "warning" };
}

export function recommendationSourceView(source: RecommendationSource): DataSourceView {
  if (source === "AI") return { label: "AI theo CV", description: "Xếp hạng theo CV đang hoạt động và độ phù hợp kỹ năng.", tone: "success" };
  if (source === "PREFERENCES") return { label: "Theo sở thích", description: "AI chưa dùng được; kết quả dựa trên sở thích nghề nghiệp.", tone: "info" };
  return { label: "Việc làm mới", description: "Hệ thống đang hiển thị các tin tuyển dụng mới nhất.", tone: "warning" };
}

export function recommendationFallbackView(reason?: FallbackReason): RecommendationFallbackView | null {
  switch (reason) {
    case "NO_ACTIVE_CV":
      return {
        title: "Chưa có CV đang hoạt động",
        description: "Tải lên hoặc kích hoạt một CV để AI có dữ liệu đối chiếu kỹ năng.",
        actionLabel: "Mở quản lý CV",
        action: "UPLOAD_CV",
      };
    case "PROFILE_UNAVAILABLE":
      return {
        title: "Hồ sơ tạm thời chưa truy cập được",
        description: "Gợi ý hiện dùng dữ liệu dự phòng trong khi hệ thống hồ sơ phục hồi.",
        actionLabel: "Tải lại hồ sơ gợi ý",
        action: "RETRY",
      };
    case "AI_UNAVAILABLE":
      return {
        title: "Dịch vụ AI tạm thời gián đoạn",
        description: "Bạn vẫn có thể xem kết quả theo sở thích hoặc tin mới nhất.",
        actionLabel: "Thử lại khi AI sẵn sàng",
        action: "RETRY",
      };
    case "AI_NOT_READY":
      return {
        title: "AI đang chuẩn bị dữ liệu",
        description: "CV hoặc tin tuyển dụng mới đang được xử lý để tạo gợi ý phù hợp.",
        actionLabel: "Kiểm tra tiến độ xử lý",
        action: "RETRY",
      };
    case "AI_RESPONSE_INVALID":
      return {
        title: "Chưa thể hiển thị kết quả AI",
        description: "Bạn vẫn có thể xem việc làm theo sở thích hoặc các tin mới nhất.",
        actionLabel: "Yêu cầu gợi ý mới",
        action: "RETRY",
      };
    case "AI_RESULTS_STALE":
      return {
        title: "Kết quả AI đã cũ",
        description: "CV hoặc dữ liệu việc làm đã thay đổi sau lần xếp hạng trước.",
        actionLabel: "Làm mới kết quả",
        action: "RETRY",
      };
    default:
      return null;
  }
}

export function canLoadMoreRecommendations(
  source: RecommendationSource | null,
  nextCursor: string | null,
): boolean {
  return source === "AI" && Boolean(nextCursor);
}

export function mergeRecommendationPage<T extends { id: string }>(
  current: T[],
  incoming: T[],
  continuation: boolean,
): T[] {
  if (!continuation) return incoming;
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
