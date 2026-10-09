"use client";

import { PageHeader, StatusBadge } from "@/components/ui";

const mockUsers = [
  { id: "1", name: "Nguyễn Văn A", email: "nguyenvana@example.com", role: "CANDIDATE", status: "ACTIVE" },
  { id: "2", name: "Trần Thị B", email: "tranthib@company.com", role: "RECRUITER", status: "ACTIVE" },
  { id: "3", name: "Lê Văn C", email: "levanc@spam.com", role: "CANDIDATE", status: "BANNED" },
];

export default function AdminUsersPage() {
  return (
    <main>
      <PageHeader
        eyebrow="QUẢN TRỊ"
        title="Quản lý người dùng"
        description="Xem danh sách người dùng và trạng thái hoạt động."
      />
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>ID</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Tên</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Email</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Vai trò</th>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Trạng thái</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, textAlign: "right" }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {mockUsers.map((user) => (
              <tr key={user.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 16px", color: "var(--muted)" }}>#{user.id}</td>
                <td style={{ padding: "12px 16px", fontWeight: 500 }}>{user.name}</td>
                <td style={{ padding: "12px 16px" }}>{user.email}</td>
                <td style={{ padding: "12px 16px" }}>
                  <StatusBadge tone={user.role === "RECRUITER" ? "info" : "neutral"}>
                    {user.role}
                  </StatusBadge>
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <StatusBadge tone={user.status === "ACTIVE" ? "success" : "danger"}>
                    {user.status}
                  </StatusBadge>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <button className="btn btn-ghost" type="button">Sửa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
