"use client";

import { PageHeader } from "@/components/ui";

export default function CVDetailPage({
  params
}: {
  params: { cvId: string }
}) {
  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE"
        title="Chi tiết CV"
        description={`Mã CV: ${params.cvId}`}
        action={<button className="btn btn-primary">Tải xuống PDF</button>}
      />
      <div className="card stack" style={{ padding: "24px" }}>
        <h3>Điểm đánh giá CV (AI)</h3>
        <p>Hệ thống AI đánh giá CV này đạt <strong>85/100</strong> điểm phù hợp với ngành Frontend Developer.</p>
        <ul>
          <li>Điểm mạnh: Trình bày rõ ràng, có kỹ năng React, Next.js.</li>
          <li>Gợi ý: Cần bổ sung thêm thông tin về các dự án cá nhân hoặc link GitHub.</li>
        </ul>
      </div>
    </main>
  );
}
