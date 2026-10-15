"use client";

import { PageHeader } from "@/components/ui";

export default function CandidateSettingsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE"
        title="Cài đặt tài khoản"
        description="Quản lý thông báo và bảo mật."
      />
      <div className="card stack" style={{ padding: "24px", maxWidth: 600 }}>
        <h3>Thông báo (Email)</h3>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input type="checkbox" id="notif-job" defaultChecked />
          <label htmlFor="notif-job">Gợi ý việc làm phù hợp hàng tuần</label>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input type="checkbox" id="notif-status" defaultChecked />
          <label htmlFor="notif-status">Cập nhật trạng thái hồ sơ ứng tuyển</label>
        </div>
        
        <hr style={{ margin: "24px 0", borderTop: "1px solid var(--line)" }} />
        
        <h3>Bảo mật</h3>
        <button className="btn btn-secondary" style={{ width: "fit-content" }}>Đổi mật khẩu</button>
        <button className="btn btn-danger" style={{ width: "fit-content", marginTop: "8px" }}>Xoá tài khoản</button>
      </div>
    </main>
  );
}
