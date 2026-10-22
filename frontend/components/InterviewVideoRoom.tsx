"use client";

import Link from "next/link";
import { EmptyState, PageHeader } from "./ui";
import { useCurrentAccount } from "./SessionGate";
import { portalSection } from "@/lib/portalRoutes";

// Scheduled interviews and chat calls have separate identities. Interview does
// not yet issue room credentials; never treat an interview ID as a Video call ID.
export function InterviewVideoRoom({ onLeave, returnLabel = "Quay lại hồ sơ" }: {
  returnLabel?: string;
  onLeave: () => void;
}) {
  const account = useCurrentAccount();
  return <section className="card stack">
    <PageHeader title="Phòng phỏng vấn" />
    <EmptyState title="Phỏng vấn trực tuyến theo lịch chưa được mở"
      description="Lịch phỏng vấn hiện hỗ trợ gặp trực tiếp. Để gọi video, hãy mở cuộc trò chuyện và dùng chức năng gọi video." />
    <div className="btn-group">
      <Link className="btn btn-primary" href={portalSection(account?.role ?? "CANDIDATE", "messages")}>Mở tin nhắn</Link>
      <button className="btn" type="button" onClick={onLeave}>{returnLabel}</button>
    </div>
  </section>;
}
