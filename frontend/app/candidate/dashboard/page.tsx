"use client";

import { PageHeader, EmptyState } from "@/components/ui";

export default function CandidateDashboardPage() {
  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE"
        title="Dashboard Ứng viên"
        description="Tổng quan về hành trình tìm việc của bạn."
      />
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "24px", marginBottom: "32px" }}>
        <div className="card" style={{ padding: "24px" }}>
          <h4 className="muted" style={{ margin: "0 0 8px" }}>Việc đã lưu</h4>
          <strong style={{ fontSize: "2rem" }}>5</strong>
        </div>
        <div className="card" style={{ padding: "24px" }}>
          <h4 className="muted" style={{ margin: "0 0 8px" }}>Hồ sơ đã nộp</h4>
          <strong style={{ fontSize: "2rem" }}>12</strong>
        </div>
        <div className="card" style={{ padding: "24px" }}>
          <h4 className="muted" style={{ margin: "0 0 8px" }}>Lịch phỏng vấn</h4>
          <strong style={{ fontSize: "2rem" }}>2</strong>
        </div>
      </div>

      <EmptyState
        title="Bắt đầu tìm kiếm cơ hội"
        description="Khám phá hàng ngàn công việc IT và Tech phù hợp với bạn."
        href="/candidate/jobs"
        action="Tìm việc ngay"
      />
    </main>
  );
}
