"use client";

import Link from "next/link";
import { EmptyState, PageHeader } from "./ui";

// Scheduled interviews and chat calls have separate identities. Interview does
// not yet issue room credentials; never treat an interview ID as a Video call ID.
export function InterviewVideoRoom({ onLeave, returnLabel = "Quay lại hồ sơ" }: {
  returnLabel?: string;
  onLeave: () => void;
}) {
  return <section className="card stack">
    <PageHeader title="Phòng phỏng vấn" />
    <EmptyState title="Phỏng vấn trực tuyến theo lịch chưa được mở"
      description="Lịch phỏng vấn hiện hỗ trợ gặp trực tiếp. Để gọi video, hãy mở cuộc trò chuyện và dùng chức năng gọi video." />
    <div className="btn-group">
      <Link className="btn btn-primary" href="/messages">Mở tin nhắn</Link>
      <button className="btn" type="button" onClick={onLeave}>{returnLabel}</button>
    </div>
  </section>;
}
