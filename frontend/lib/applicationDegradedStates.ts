export interface BookmarkDegradedInput {
  jobId: string;
  job: { title: string; exists: boolean } | null;
}

export function bookmarkCardView(bookmark: BookmarkDegradedInput) {
  if (!bookmark.job) {
    return {
      available: false as const,
      title: "Chi tiết việc làm tạm thời không khả dụng",
      description: `Tin đã lưu (${bookmark.jobId}) vẫn được giữ. Hãy thử lại để tải nội dung việc làm.`,
    };
  }
  return {
    available: true as const,
    title: bookmark.job.title,
    description: bookmark.job.exists
      ? "Thông tin việc làm đã được đồng bộ."
      : "Tin không còn tồn tại nhưng vẫn được giữ trong danh sách đã lưu của bạn.",
  };
}

export function activeJobsMetricView(activeJobs: { count: number | null; available: boolean }) {
  if (!activeJobs.available || activeJobs.count === null) {
    return {
      value: "—",
      detail: "Chưa tải được thống kê tin tuyển dụng; các số liệu hồ sơ khác vẫn được hiển thị.",
      degraded: true,
    };
  }
  return { value: String(activeJobs.count), detail: "Tin đang nhận hồ sơ", degraded: false };
}

export function dashboardWarningView(code: string) {
  if (code === "JOB_SERVICE_UNAVAILABLE") {
    return "Chưa lấy được số tin đang tuyển. Các thống kê hồ sơ bên dưới vẫn có thể sử dụng.";
  }
  return "Một nguồn dữ liệu phụ đang gián đoạn. Các số liệu còn lại vẫn được hiển thị.";
}
