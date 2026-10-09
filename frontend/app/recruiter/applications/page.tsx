"use client";

import Link from "next/link";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui";

const mockApplications = [
  { id: "app-1", candidateName: "Nguyễn Văn A", jobTitle: "Senior Frontend Engineer", status: "NEW", date: "20/10/2026" },
  { id: "app-2", candidateName: "Trần Thị B", jobTitle: "Product Manager", status: "INTERVIEWING", date: "18/10/2026" },
];

export default function RecruiterApplicationsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="RECRUITER"
        title="Quản lý Hồ sơ ứng tuyển"
        description="Xem và xử lý hồ sơ ứng viên gửi đến các tin tuyển dụng của công ty."
      />
      
      {mockApplications.length > 0 ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "12px 16px", fontWeight: 600 }}>Ứng viên</th>
                <th style={{ padding: "12px 16px", fontWeight: 600 }}>Vị trí</th>
                <th style={{ padding: "12px 16px", fontWeight: 600 }}>Ngày nộp</th>
                <th style={{ padding: "12px 16px", fontWeight: 600 }}>Trạng thái</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, textAlign: "right" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {mockApplications.map((app) => (
                <tr key={app.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 500 }}>{app.candidateName}</td>
                  <td style={{ padding: "12px 16px", color: "var(--muted)" }}>{app.jobTitle}</td>
                  <td style={{ padding: "12px 16px" }}>{app.date}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <StatusBadge tone={app.status === "NEW" ? "info" : "warning"}>
                      {app.status}
                    </StatusBadge>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    <Link className="btn btn-secondary" href={`/recruiter/applications/${app.id}`}>
                      Chi tiết
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Chưa có hồ sơ"
          description="Chưa có ứng viên nào nộp hồ sơ vào các vị trí tuyển dụng của bạn."
        />
      )}
    </main>
  );
}
