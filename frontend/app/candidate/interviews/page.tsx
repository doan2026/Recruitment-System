"use client";

import Link from "next/link";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui";

const mockInterviews = [
  { id: "iv-1", jobTitle: "Senior Frontend Engineer", company: "Công ty Cổ phần Mộc Công Nghệ", time: "14:00 - 15:00, 20/10/2026", status: "SCHEDULED" },
  { id: "iv-2", jobTitle: "Product Manager", company: "Tập đoàn VinaCorp", time: "09:00 - 10:00, 15/10/2026", status: "COMPLETED" },
];

export default function CandidateInterviewsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE"
        title="Lịch phỏng vấn"
        description="Theo dõi và tham gia các buổi phỏng vấn trực tuyến."
      />
      
      {mockInterviews.length > 0 ? (
        <div className="card stack">
          {mockInterviews.map((iv) => (
            <div key={iv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderBottom: "1px solid var(--line)" }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>{iv.jobTitle}</h3>
                <p className="muted" style={{ margin: "0 0 8px" }}>{iv.company} • {iv.time}</p>
                <StatusBadge tone={iv.status === "SCHEDULED" ? "info" : "success"}>
                  {iv.status === "SCHEDULED" ? "Sắp diễn ra" : "Đã hoàn thành"}
                </StatusBadge>
              </div>
              <div>
                {iv.status === "SCHEDULED" && (
                  <Link href={`/candidate/interviews/${iv.id}/room`} className="btn btn-primary">
                    Vào phòng phỏng vấn
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Chưa có lịch phỏng vấn"
          description="Bạn chưa có lịch phỏng vấn nào sắp tới. Hãy tiếp tục ứng tuyển nhé."
          href="/candidate/jobs"
          action="Tìm việc ngay"
        />
      )}
    </main>
  );
}
