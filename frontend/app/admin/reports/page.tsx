"use client";

import { PageHeader, StatusBadge } from "@/components/ui";

const mockReports = [
  { id: "r1", type: "JOB", target: "Job: Tuyển dụng lập trình viên ảo", reason: "Lừa đảo, thu phí", reporter: "user_123", status: "UNRESOLVED" },
  { id: "r2", type: "COMPANY", target: "Công ty ma", reason: "Thông tin giả mạo", reporter: "user_456", status: "RESOLVED" },
];

export default function AdminReportsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="QUẢN TRỊ"
        title="Báo cáo vi phạm"
        description="Xử lý các nội dung vi phạm tiêu chuẩn cộng đồng."
      />
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Đối tượng</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Loại</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Lý do</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Trạng thái</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, textAlign: "right" }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {mockReports.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 16px", fontWeight: 500 }}>{r.target}</td>
                <td style={{ padding: "12px 16px", color: "var(--muted)" }}>{r.type}</td>
                <td style={{ padding: "12px 16px", color: "var(--danger)" }}>{r.reason}</td>
                <td style={{ padding: "12px 16px" }}>
                  <StatusBadge tone={r.status === "RESOLVED" ? "success" : "warning"}>
                    {r.status}
                  </StatusBadge>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <button className="btn btn-secondary" type="button" style={{ padding: "6px 12px", minHeight: "32px", fontSize: "0.85rem" }}>
                    Xử lý
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
