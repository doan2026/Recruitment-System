"use client";

import { PageHeader, StatusBadge } from "@/components/ui";

export default function CandidateProfileRecruiterViewPage({
  params
}: {
  params: { candidateId: string }
}) {
  return (
    <main>
      <PageHeader
        eyebrow="HỒ SƠ ỨNG VIÊN TỰ DO"
        title="Trần Thị B"
        description="Backend Developer"
        action={<button className="btn btn-primary">Mời ứng tuyển</button>}
      />

      <div style={{ display: "flex", gap: "24px" }}>
        <div className="card stack" style={{ flex: 1, padding: "24px" }}>
          <h3>Kỹ năng</h3>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <StatusBadge tone="neutral">Node.js</StatusBadge>
            <StatusBadge tone="neutral">NestJS</StatusBadge>
            <StatusBadge tone="neutral">PostgreSQL</StatusBadge>
          </div>
          <hr style={{ margin: "16px 0", borderTop: "1px solid var(--line)" }} />
          <h3>Kinh nghiệm</h3>
          <p><strong>VinaCorp</strong> (2024 - Hiện tại)<br/>Backend Developer</p>
        </div>
        
        <div className="card stack" style={{ width: 320, padding: "24px", background: "var(--surface)" }}>
          <h3>Điểm AI Đánh giá</h3>
          <p>Mức độ phù hợp với các job đang mở của bạn:</p>
          <div style={{ padding: "12px", background: "white", borderRadius: "8px", border: "1px solid var(--line)" }}>
            <p style={{ margin: "0 0 4px" }}><strong>Backend Dev</strong></p>
            <StatusBadge tone="success">92% Match</StatusBadge>
          </div>
        </div>
      </div>
    </main>
  );
}
