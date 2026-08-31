export type StaleCursorCode = "JOB_SEARCH_CURSOR_STALE" | "RECOMMENDATION_CURSOR_STALE";

export interface CursorRestartView {
  code: StaleCursorCode;
  message: string;
}

export function cursorRestartView(code: string): CursorRestartView | null {
  if (code === "JOB_SEARCH_CURSOR_STALE") {
    return {
      code,
      message: "Kết quả tìm việc vừa thay đổi. Danh sách đã được tải lại từ đầu bằng snapshot mới.",
    };
  }
  if (code === "RECOMMENDATION_CURSOR_STALE") {
    return {
      code,
      message: "Gợi ý việc làm vừa được cập nhật. Danh sách gợi ý đã được tải lại từ đầu.",
    };
  }
  return null;
}
