"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";

export default function ScheduleInterviewPage({
  params
}: {
  params: { applicationId: string }
}) {
  const router = useRouter();

  return (
    <main style={{ maxWidth: 600, margin: "0 auto" }}>
      <PageHeader
        eyebrow="ĐẶT LỊCH PHỎNG VẤN"
        title="Tạo lịch phỏng vấn mới"
        description={`Ứng viên từ đơn số: ${params.applicationId}`}
      />
      <form className="card stack" style={{ padding: "24px" }} onSubmit={(e) => { e.preventDefault(); router.push(`/recruiter/applications/${params.applicationId}`); }}>
        <div className="field">
          <label className="label">Hình thức</label>
          <select className="input">
            <option>Video Call (Online)</option>
            <option>Phỏng vấn trực tiếp (Offline)</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Thời gian dự kiến</label>
          <input className="input" type="datetime-local" />
        </div>
        <div className="field">
          <label className="label">Lời nhắn / Ghi chú</label>
          <textarea className="input" rows={4} placeholder="Link Google Meet hoặc địa chỉ công ty..." />
        </div>
        <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
          <button type="button" className="btn btn-secondary" onClick={() => router.back()}>Huỷ</button>
          <button type="submit" className="btn btn-primary">Gửi lịch phỏng vấn</button>
        </div>
      </form>
    </main>
  );
}
