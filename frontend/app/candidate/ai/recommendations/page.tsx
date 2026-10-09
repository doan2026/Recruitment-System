"use client";

import { PageHeader, StatusBadge } from "@/components/ui";

const mockRecommendations = [
  { id: "1", title: "Senior React Developer", company: "VinaCorp", match: 92, reason: "Phù hợp kỹ năng React, Next.js và kinh nghiệm 3+ năm." },
  { id: "2", title: "Fullstack Engineer", company: "Tech Startup", match: 78, reason: "Thiếu kinh nghiệm Node.js thực tế nhưng mạnh về Frontend." },
];

export default function AIRecommendationsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="AI ASSISTANT"
        title="Gợi ý việc làm (AI)"
        description="Hệ thống AI phân tích CV và kỹ năng của bạn để tìm ra các công việc phù hợp nhất."
      />
      
      <div className="card stack">
        {mockRecommendations.map(job => (
          <div key={job.id} style={{ display: "flex", gap: "16px", padding: "16px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 80, height: 80, background: "var(--surface)", borderRadius: "var(--radius-control)" }}>
              <strong style={{ fontSize: "1.5rem", color: job.match >= 90 ? "var(--success)" : "var(--warning)" }}>{job.match}%</strong>
              <small>Match</small>
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: "0 0 4px" }}>{job.title}</h3>
              <p className="muted" style={{ margin: "0 0 8px" }}>{job.company}</p>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>💡 <em>{job.reason}</em></p>
            </div>
            <div>
              <button className="btn btn-primary">Xem chi tiết</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
