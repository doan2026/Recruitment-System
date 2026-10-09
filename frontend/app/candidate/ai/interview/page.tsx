"use client";

import { PageHeader, EmptyState } from "@/components/ui";

export default function AIInterviewPracticePage() {
  return (
    <main>
      <PageHeader
        eyebrow="AI ASSISTANT"
        title="Luyện tập phỏng vấn AI"
        description="Trả lời các câu hỏi giả định và nhận phản hồi chi tiết từ AI để cải thiện kỹ năng."
      />
      <div style={{ display: "flex", gap: "24px", height: "calc(100vh - 200px)" }}>
        <div className="card" style={{ flex: 2, display: "flex", flexDirection: "column", background: "black", color: "white", justifyContent: "center", alignItems: "center" }}>
          {/* Mô phỏng khung video AI */}
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
            <span style={{ fontSize: "2rem" }}>🤖</span>
          </div>
          <h3 style={{ margin: "0 0 16px" }}>AI Interviewer đang đợi...</h3>
          <p style={{ maxWidth: 400, textAlign: "center", color: "#ccc" }}>"Bạn hãy mô tả một dự án khó nhất mà bạn từng tham gia và cách bạn giải quyết các vấn đề trong đó."</p>
        </div>
        
        <div className="card stack" style={{ flex: 1, padding: "24px" }}>
          <h3>Khung trả lời</h3>
          <textarea className="input" rows={6} placeholder="Nhập câu trả lời của bạn vào đây, hoặc nhấn nút ghi âm..." style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
            <button className="btn btn-secondary" style={{ flex: 1 }}>🎤 Ghi âm</button>
            <button className="btn btn-primary" style={{ flex: 1 }}>Gửi trả lời</button>
          </div>
        </div>
      </div>
    </main>
  );
}
