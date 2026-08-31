"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { PageHeader, StatusBadge } from "../../components/ui";
import { createChatSessionId, toUserMessage } from "../../lib/apiClient";
import { appendAiChatExchange, createAiChatConversation, type AiChatMessage } from "../../lib/aiChatConversation";
import { isAiChatSessionBusy } from "../../lib/aiChatSessionLock";
import { sendAiChatMessage } from "../../lib/person2Api";

export default function AiAssistantPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>(() => createAiChatConversation());
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const exchangeSequence = useRef(0);

  useEffect(() => {
    setSessionId(createChatSessionId());
  }, []);

  function startNewConversation() {
    setSessionId(createChatSessionId());
    setMessages(createAiChatConversation());
    setDraft("");
    setError("");
    setSessionBusy(false);
    exchangeSequence.current = 0;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeSessionId = sessionId;
    const message = draft.trim();
    if (!activeSessionId || !message || pending) return;

    setPending(true);
    setError("");
    setSessionBusy(false);
    try {
      const response = await sendAiChatMessage(activeSessionId, message);
      exchangeSequence.current += 1;
      setMessages((current) => appendAiChatExchange(
        current,
        message,
        response.data.answer,
        `${activeSessionId}-${exchangeSequence.current}`,
      ));
      setDraft("");
    } catch (reason: unknown) {
      if (isAiChatSessionBusy(reason)) {
        setSessionBusy(true);
        setError("Phiên đang xử lý một tin nhắn khác. Hãy đợi rồi bấm Thử lại; hệ thống không tự gửi lại để tránh ghi trùng lịch sử.");
      } else {
        setError(toUserMessage(reason));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <PageHeader
        eyebrow="CANDIDATE · AI ASSISTANT"
        title="Trợ lý nghề nghiệp"
        description="Mỗi cuộc trò chuyện dùng một session UUID v4 riêng, chỉ giữ trong bộ nhớ của tab hiện tại."
      />
      <section className="chat-layout">
        <section className="panel">
          <div className="section-head">
            <div><h2>Cuộc trò chuyện mới</h2><p className="help">Backend không có endpoint tạo session; trình duyệt tạo định danh canonical sau khi trang sẵn sàng.</p></div>
            <StatusBadge tone={sessionId ? "success" : "warning"}>{sessionId ? "Session sẵn sàng" : "Đang tạo session"}</StatusBadge>
          </div>
          <div className="chat-box" aria-live="polite" aria-label="Lịch sử hội thoại trong tab hiện tại">
            {messages.map((message) => (
              <div className={`message ${message.role === "assistant" ? "bot" : "user"}`} key={message.id}>
                {message.content}
              </div>
            ))}
            {pending ? <div className="message bot" role="status">AI đang soạn câu trả lời…</div> : null}
          </div>
          {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
          <form className="chat-composer" noValidate onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="ai-chat-message">Tin nhắn cho trợ lý nghề nghiệp</label>
            <textarea id="ai-chat-message" className="textarea resize-none" rows={3} value={draft} disabled={!sessionId || pending} placeholder="Hỏi về tìm việc hoặc quy trình ứng tuyển…" onChange={(event) => setDraft(event.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={!sessionId || pending || !draft.trim()}>{pending ? "Đang gửi…" : sessionBusy ? "Thử lại" : "Gửi tin nhắn"}</button>
          </form>
        </section>
        <aside className="panel">
          <p className="eyebrow">SESSION BOUNDARY</p>
          <h2>Không lưu trên trình duyệt</h2>
          <p className="help">Session ID không được ghi vào bộ nhớ bền vững hay URL. Reload trang sẽ tạo một session hiển thị mới.</p>
          <p className="status-line">Mã phiên: {sessionId ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : "đang tạo"}</p>
          <p className="notice notice-warning">API chỉ trả một câu trả lời cho mỗi tin nhắn và không có endpoint đọc lại lịch sử. Reload sẽ mất các tin đang hiển thị.</p>
          <button className="btn" type="button" disabled={!sessionId || pending} onClick={startNewConversation}>Bắt đầu hội thoại mới</button>
        </aside>
      </section>
    </main>
  );
}
