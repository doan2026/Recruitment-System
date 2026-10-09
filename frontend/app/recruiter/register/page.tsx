"use client";

import { PublicShell } from "@/components/PublicShell";

export default function RecruiterRegisterPage() {
  return (
    <PublicShell>
      <section className="page-section" style={{ maxWidth: 460, margin: "60px auto", border: "none", background: "transparent", boxShadow: "none" }}>
        <div className="page-header" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "8px" }}>
          <h1 className="page-title">Đăng ký Nhà tuyển dụng</h1>
          <p className="muted" style={{ margin: 0 }}>Tạo tài khoản để đăng tin tuyển dụng ngay.</p>
        </div>
        <form className="card stack" noValidate style={{ padding: "32px 24px" }}>
          <div className="field">
            <label className="label">Tên công ty</label>
            <input className="input" type="text" placeholder="Công ty TNHH ABC" />
          </div>
          <div className="field">
            <label className="label">Họ tên người đại diện</label>
            <input className="input" type="text" placeholder="Nguyễn Văn A" />
          </div>
          <div className="field">
            <label className="label">Email công việc</label>
            <input className="input" type="email" placeholder="name@company.com" />
          </div>
          <div className="field">
            <label className="label">Mật khẩu</label>
            <input className="input" type="password" />
          </div>
          <button className="btn btn-primary btn-large" style={{ marginTop: "12px" }} type="button">Tạo tài khoản doanh nghiệp</button>
        </form>
      </section>
    </PublicShell>
  );
}
