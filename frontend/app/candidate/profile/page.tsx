"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";

export default function CandidateProfilePage() {
  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE"
        title="Hồ sơ cá nhân"
        description="Quản lý thông tin cá nhân và định hướng nghề nghiệp."
        action={<Link className="btn btn-primary" href="/candidate/profile/cvs">Quản lý CV</Link>}
      />

      <div className="card stack" style={{ padding: "24px" }}>
        <h3>Thông tin liên hệ</h3>
        <div className="field">
          <label className="label">Họ và tên</label>
          <input className="input" type="text" defaultValue="Nguyễn Văn A" />
        </div>
        <div className="field">
          <label className="label">Số điện thoại</label>
          <input className="input" type="text" defaultValue="0912345678" />
        </div>
        <div className="field">
          <label className="label">Nơi làm việc hiện tại</label>
          <input className="input" type="text" defaultValue="Hà Nội" />
        </div>
        <button className="btn btn-secondary" style={{ width: "fit-content", marginTop: "16px" }}>Cập nhật thông tin</button>
      </div>
    </main>
  );
}
