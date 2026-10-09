"use client";

import { PageHeader } from "@/components/ui";

export default function NewCVPage() {
  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE"
        title="Tạo CV Online"
        description="Điền thông tin để tạo CV chuyên nghiệp từ template của hệ thống."
      />
      <div style={{ display: "flex", gap: "24px" }}>
        <div className="card stack" style={{ flex: 1, padding: "24px" }}>
          <h3>Kinh nghiệm làm việc</h3>
          <input className="input" placeholder="Tên công ty" />
          <input className="input" placeholder="Vị trí" />
          <textarea className="input" placeholder="Mô tả công việc" rows={4} />
          <button className="btn btn-primary" style={{ width: "fit-content" }}>Thêm kinh nghiệm</button>
        </div>
        <div style={{ width: 400, background: "var(--surface)", border: "1px solid var(--line)", padding: "24px", borderRadius: "var(--radius-control)" }}>
          <p className="muted" style={{ textAlign: "center", marginTop: "50%" }}>Bản xem trước CV (Preview)</p>
        </div>
      </div>
    </main>
  );
}
