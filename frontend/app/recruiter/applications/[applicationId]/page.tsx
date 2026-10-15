"use client";

import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function RecruiterApplicationDetailPage({
  params
}: {
  params: { applicationId: string }
}) {
  return (
    <main>
      <PageHeader
        eyebrow="CHI TIẾT HỒ SƠ"
        title="Nguyễn Văn A"
        description="Ứng tuyển vị trí: Senior Frontend Engineer"
        action={
          <div className="btn-group">
            <Link className="btn btn-primary" href={`/recruiter/applications/${params.applicationId}/interview/room`}>Vào phỏng vấn</Link>
            <Link className="btn btn-secondary" href={`/recruiter/applications/${params.applicationId}/offer`}>Tạo Offer</Link>
          </div>
        }
      />

      <div className="card stack" style={{ padding: "24px" }}>
        <h3>Thông tin ứng viên</h3>
        <p><strong>Trạng thái: </strong> <StatusBadge tone="info">NEW</StatusBadge></p>
        <p><strong>Ngày nộp: </strong> 20/10/2026</p>
        <p><strong>Email: </strong> nguyenvana@example.com</p>
        <p><strong>Kinh nghiệm: </strong> 3 năm làm React, Next.js</p>
        <hr style={{ margin: "16px 0", borderTop: "1px solid var(--line)" }} />
        <h3>CV Đính kèm</h3>
        <div style={{ padding: "16px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-control)" }}>
          <p style={{ margin: 0 }}>📄 nguyen_van_a_cv.pdf</p>
        </div>
      </div>
    </main>
  );
}
