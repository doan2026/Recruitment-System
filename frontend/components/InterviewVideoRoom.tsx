"use client";

import { EmptyState, PageHeader } from "./ui";

// Scheduled interviews and chat calls have separate identities. Interview does
// not yet issue room credentials; never treat an interview ID as a Video call ID.
export function InterviewVideoRoom({ onLeave }: {
  interviewId: string;
  role: "CANDIDATE" | "RECRUITER";
  onLeave: () => void;
}) {
  return <section className="card stack">
    <PageHeader title="Phòng phỏng vấn" />
    <EmptyState title="Phỏng vấn trực tuyến theo lịch chưa được mở"
      description="Lịch phỏng vấn hiện hỗ trợ gặp trực tiếp. Để gọi video, hãy mở cuộc trò chuyện và dùng chức năng gọi video." />
    <div className="btn-group">
      <a className="btn btn-primary" href="/messages">Mở tin nhắn</a>
      <button className="btn" type="button" onClick={onLeave}>Quay lại hồ sơ</button>
    </div>
  </section>;
}
