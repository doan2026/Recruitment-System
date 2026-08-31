export interface BookmarkDegradedInput {
  jobId: string;
  job: { title: string; exists: boolean } | null;
}

export function bookmarkCardView(bookmark: BookmarkDegradedInput) {
  if (!bookmark.job) {
    return {
      available: false as const,
      title: "Chi tiết việc làm tạm thời không khả dụng",
      description: `Bookmark ${bookmark.jobId} vẫn được giữ. Hãy thử lại khi Job Service hoạt động ổn định.`,
    };
  }
  return {
    available: true as const,
    title: bookmark.job.title,
    description: bookmark.job.exists
      ? "Thông tin việc làm đã được đồng bộ."
      : "Tin đã không còn tồn tại nhưng bookmark vẫn được giữ để bạn nhận biết.",
  };
}

export function activeJobsMetricView(activeJobs: { count: number | null; available: boolean }) {
  if (!activeJobs.available || activeJobs.count === null) {
    return {
      value: "—",
      detail: "Job Service đang gián đoạn; các số liệu Application khác vẫn chính xác.",
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
