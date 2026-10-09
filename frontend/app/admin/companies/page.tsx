"use client";

import { PageHeader, StatusBadge } from "@/components/ui";

const mockCompanies = [
  { id: "c1", name: "Công ty Cổ phần Mộc Công Nghệ", industry: "Công nghệ thông tin", status: "PENDING_VERIFICATION", reports: 0 },
  { id: "c2", name: "Tập đoàn VinaCorp", industry: "Bất động sản", status: "VERIFIED", reports: 2 },
];

export default function AdminCompaniesPage() {
  return (
    <main>
      <PageHeader
        eyebrow="QUẢN TRỊ"
        title="Duyệt hồ sơ công ty"
        description="Xác thực pháp nhân công ty và xem xét các báo cáo vi phạm."
      />
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Tên công ty</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Lĩnh vực</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Bị báo cáo</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Trạng thái</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, textAlign: "right" }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {mockCompanies.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 16px", fontWeight: 500 }}>{c.name}</td>
                <td style={{ padding: "12px 16px", color: "var(--muted)" }}>{c.industry}</td>
                <td style={{ padding: "12px 16px", color: c.reports > 0 ? "var(--danger-soft)" : "inherit" }}>
                  {c.reports > 0 ? `${c.reports} lần` : "Không có"}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <StatusBadge tone={c.status === "VERIFIED" ? "success" : "warning"}>
                    {c.status}
                  </StatusBadge>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <button className="btn btn-primary" type="button" style={{ padding: "6px 12px", minHeight: "32px", fontSize: "0.85rem" }}>
                    Xem chi tiết
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
