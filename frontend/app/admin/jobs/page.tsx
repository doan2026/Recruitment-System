"use client";

import { PageHeader, StatusBadge } from "@/components/ui";

const mockJobs = [
  { id: "j1", title: "Senior Frontend Engineer", company: "Công ty Cổ phần Mộc Công Nghệ", status: "PUBLISHED" },
  { id: "j2", title: "Product Manager", company: "Tập đoàn VinaCorp", status: "DRAFT" },
  { id: "j3", title: "Tuyển dụng Tester", company: "Công ty Spam", status: "REJECTED" },
];

export default function AdminJobsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="QUẢN TRỊ"
        title="Quản lý việc làm"
        description="Quản lý tất cả các tin tuyển dụng trên hệ thống."
      />
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Tên việc làm</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Công ty</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Trạng thái</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, textAlign: "right" }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {mockJobs.map((j) => (
              <tr key={j.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 16px", fontWeight: 500 }}>{j.title}</td>
                <td style={{ padding: "12px 16px", color: "var(--muted)" }}>{j.company}</td>
                <td style={{ padding: "12px 16px" }}>
                  <StatusBadge tone={j.status === "PUBLISHED" ? "success" : j.status === "REJECTED" ? "danger" : "neutral"}>
                    {j.status}
                  </StatusBadge>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <button className="btn btn-secondary" type="button" style={{ padding: "6px 12px", minHeight: "32px", fontSize: "0.85rem" }}>
                    Chỉnh sửa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
