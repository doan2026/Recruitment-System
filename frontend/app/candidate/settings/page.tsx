"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Person1Gate } from "@/components/Person1Gate";

export default function CandidateSettingsPage() {
  return <Person1Gate role="CANDIDATE">
    <main className="form-stack">
      <PageHeader eyebrow="ỨNG VIÊN" title="Cài đặt tài khoản" description="Quản lý thông báo và bảo mật tài khoản." />
      <div className="grid-2">
      <section className="card form-stack">
        <div className="section-head"><h2>Thông báo</h2></div>
        <p>Xem cập nhật về hồ sơ ứng tuyển và lịch phỏng vấn của bạn.</p>
        <Link className="btn" href="/notifications">Xem thông báo</Link>
        <p className="help">Tùy chỉnh nhận email chưa khả dụng.</p>
      </section>
      <section className="card form-stack">
        <div className="section-head"><h2>Bảo mật</h2></div>
        <p>Yêu cầu liên kết qua email đăng nhập để đặt lại mật khẩu.</p>
        <Link className="btn btn-secondary" href="/forgot-password">Đặt lại mật khẩu</Link>
        <p className="help">Tự xóa tài khoản chưa được hỗ trợ.</p>
      </section>
      </div>
    </main>
  </Person1Gate>;
}
