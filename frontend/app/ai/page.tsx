"use client";

import { useEffect, useState } from "react";
import { PageHeader, StatusBadge } from "../../components/ui";
import { createChatSessionId } from "../../lib/apiClient";

export default function AiAssistantPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(createChatSessionId());
  }, []);

  function startNewConversation() {
    setSessionId(createChatSessionId());
  }

  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE · AI ASSISTANT"
        title="Trợ lý nghề nghiệp"
        description="Mỗi cuộc trò chuyện dùng một session UUID v4 riêng, chỉ giữ trong bộ nhớ của tab hiện tại."
      />
      <section className="grid-2">
        <section className="panel">
          <div className="section-head">
            <div><h2>Cuộc trò chuyện mới</h2><p className="help">Backend không có endpoint tạo session; trình duyệt tạo định danh canonical sau khi trang sẵn sàng.</p></div>
            <StatusBadge tone={sessionId ? "success" : "warning"}>{sessionId ? "Session sẵn sàng" : "Đang tạo session"}</StatusBadge>
          </div>
          <div className="chat-box" aria-live="polite">
            <div className="message bot">Xin chào! Mình có thể hỗ trợ bạn về tìm việc và quy trình ứng tuyển.</div>
          </div>
          <div className="btn-group">
            <button className="btn" type="button" disabled={!sessionId} onClick={startNewConversation}>Bắt đầu hội thoại mới</button>
          </div>
        </section>
        <aside className="panel">
          <p className="eyebrow">SESSION BOUNDARY</p>
          <h2>Không lưu trên trình duyệt</h2>
          <p className="help">Session ID không được ghi vào bộ nhớ bền vững hay URL. Reload trang sẽ tạo một session hiển thị mới.</p>
          <p className="status-line">Mã phiên: {sessionId ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : "đang tạo"}</p>
        </aside>
      </section>
    </main>
  );
}
