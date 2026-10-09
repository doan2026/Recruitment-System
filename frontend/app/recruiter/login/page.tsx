"use client";

import { PublicShell } from "@/components/PublicShell";

export default function RecruiterLoginPage() {
  return (
    <PublicShell>
      <section className="page-section" style={{ maxWidth: 460, margin: "60px auto", border: "none", background: "transparent", boxShadow: "none" }}>
        <div className="page-header" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "8px" }}>
          <h1 className="page-title">Đăng nhập Nhà tuyển dụng</h1>
          <p className="muted" style={{ margin: 0 }}>Dành riêng cho doanh nghiệp. Vui lòng đăng nhập.</p>
        </div>
        <form className="card stack" noValidate style={{ padding: "32px 24px" }}>
          <div className="field">
            <label className="label">Email công việc</label>
            <input className="input" type="email" placeholder="name@company.com" />
          </div>
          <div className="field">
            <label className="label">Mật khẩu</label>
            <input className="input" type="password" />
          </div>
          <button className="btn btn-primary btn-large" style={{ marginTop: "12px" }} type="button">Đăng nhập không mật khẩu (Demo)</button>
          <div style={{ textAlign: "center", marginTop: "20px", paddingTop: "20px", borderTop: "1px solid var(--line)" }}>
            <p className="help" style={{ marginBottom: "8px" }}>Doanh nghiệp chưa có tài khoản?</p>
            <a href="/recruiter/register" className="text-link">Đăng ký tài khoản doanh nghiệp <span>&rarr;</span></a>
          </div>
        </form>
      </section>
    </PublicShell>
  );
}
