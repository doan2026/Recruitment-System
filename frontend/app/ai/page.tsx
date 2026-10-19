"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { createChatSessionId, toUserMessage } from "../../lib/apiClient";
import { appendAiChatExchange, createAiChatConversation, type AiChatMessage } from "../../lib/aiChatConversation";
import { classifyAiChatBackpressure, runAiChatWithBusyRetry } from "../../lib/aiChatBackpressure";
import { isAiChatSessionBusy } from "../../lib/aiChatSessionLock";
import { classifyAiChatFeatureState, type AiChatFeatureState } from "../../lib/aiChatFeatureState";
import { validateAiChatMessage } from "../../lib/aiChatMessage";
import { presentAiChatResponse } from "../../lib/aiChatResponse";
import { sendAiChatMessage } from "../../lib/person2Api";

function AssistantMessage({ content }: { content: string }) {
  const presentation = presentAiChatResponse(content);
  return (
    <div className="message bot">
      {presentation.jobLines.length > 0 ? (
        <>
          {presentation.introduction ? <p className="chat-response-text">{presentation.introduction}</p> : null}
          <ol className="chat-job-list">
            {presentation.jobLines.map((item) => <li key={item.jobId}>{item.text}</li>)}
          </ol>
          {presentation.conclusion ? <p className="chat-response-text">{presentation.conclusion}</p> : null}
        </>
      ) : <p className="chat-response-text">{presentation.text}</p>}
      {presentation.hasSuitableJobsIntent ? <Link className="btn btn-secondary chat-response-cta" href="/candidate/jobs#suitable-jobs">Mở Việc làm phù hợp</Link> : null}
    </div>
  );
}

export default function AiAssistantPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>(() => createAiChatConversation());
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [featureState, setFeatureState] = useState<AiChatFeatureState>(null);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const exchangeSequence = useRef(0);
  const draftValidation = validateAiChatMessage(draft);

  useEffect(() => {
    setSessionId(createChatSessionId());
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => setCooldownSeconds((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  function startNewConversation() {
    setSessionId(createChatSessionId());
    setMessages(createAiChatConversation());
    setDraft("");
    setError("");
    setSessionBusy(false);
    setCooldownSeconds(0);
    setFeatureState(null);
    setValidationAttempted(false);
    exchangeSequence.current = 0;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeSessionId = sessionId;
    setValidationAttempted(true);
    if (!activeSessionId || draftValidation.errorCode || pending || cooldownSeconds > 0) return;
    const message = draftValidation.value;

    setPending(true);
    setError("");
    setSessionBusy(false);
    try {
      const response = await runAiChatWithBusyRetry(() => sendAiChatMessage(activeSessionId, message));
      exchangeSequence.current += 1;
      setMessages((current) => appendAiChatExchange(
        current,
        message,
        response.data.answer,
        `${activeSessionId}-${exchangeSequence.current}`,
      ));
      setDraft("");
      setValidationAttempted(false);
    } catch (reason: unknown) {
      const nextFeatureState = classifyAiChatFeatureState(reason);
      if (nextFeatureState) {
        setFeatureState(nextFeatureState);
        setError("");
      } else if (isAiChatSessionBusy(reason)) {
        setSessionBusy(true);
        setError("Phiên đang xử lý một tin nhắn khác. Hãy đợi rồi bấm Thử lại; hệ thống không tự gửi lại để tránh ghi trùng lịch sử.");
      } else {
        const backpressure = classifyAiChatBackpressure(reason);
        if (backpressure?.kind === "rate-limit") {
          setCooldownSeconds(backpressure.retryAfterSeconds);
          setError("");
        } else if (backpressure?.kind === "busy") {
          setSessionBusy(true);
          setError("Trợ lý vẫn đang bận sau một lần tự thử lại ngắn. Hãy bấm Thử lại khi bạn sẵn sàng.");
        } else if (backpressure?.kind === "manual") {
          setSessionBusy(true);
          setError(toUserMessage(reason));
        } else {
          setError(toUserMessage(reason));
        }
      }
    } finally {
      setPending(false);
    }
  }

  if (featureState === "hidden") {
    return <main><PageHeader eyebrow="ĐỊNH HƯỚNG NGHỀ NGHIỆP" title="Trợ lý nghề nghiệp" /><EmptyState title="Tính năng chưa được mở" description="Trợ lý hiện chưa sẵn sàng. Bạn có thể tiếp tục tìm việc và xem gợi ý theo hồ sơ." href="/candidate/jobs" action="Khám phá việc làm" /></main>;
  }

  if (featureState === "forbidden") {
    return <main><PageHeader eyebrow="ĐỊNH HƯỚNG NGHỀ NGHIỆP" title="Trợ lý nghề nghiệp" /><EmptyState title="Tài khoản không phù hợp" description="Trợ lý nghề nghiệp dành cho ứng viên. Hãy chuyển sang tài khoản ứng viên để sử dụng." href="/login?returnTo=%2Fai" action="Đăng nhập ứng viên" /></main>;
  }

  if (featureState === "reauthenticate") {
    return <main><PageHeader eyebrow="ĐỊNH HƯỚNG NGHỀ NGHIỆP" title="Trợ lý nghề nghiệp" /><EmptyState title="Phiên đăng nhập đã hết hạn" description="Hãy đăng nhập lại bằng tài khoản ứng viên để tiếp tục trò chuyện." href="/login?returnTo=%2Fai" action="Đăng nhập lại" /></main>;
  }

  return (
    <main>
      <PageHeader
        eyebrow="ĐỊNH HƯỚNG NGHỀ NGHIỆP"
        title="Trợ lý nghề nghiệp"
        description="Trao đổi về định hướng nghề nghiệp, tìm việc và chuẩn bị cho hành trình ứng tuyển."
      />
      <section className="chat-layout">
        <section className="panel">
          <div className="section-head">
            <div><h2>Cuộc trò chuyện mới</h2><p className="help">Chia sẻ kỹ năng, kinh nghiệm hoặc công việc bạn đang quan tâm.</p></div>
            <StatusBadge tone={sessionId ? "success" : "warning"}>{sessionId ? "Sẵn sàng trò chuyện" : "Đang chuẩn bị"}</StatusBadge>
          </div>
          <div className="chat-box" aria-live="polite" aria-label="Lịch sử hội thoại trong tab hiện tại">
            {messages.map((message) => (
              message.role === "assistant"
                ? <AssistantMessage content={message.content} key={message.id} />
                : <div className="message user" key={message.id}>{message.content}</div>
            ))}
            {pending ? <div className="message bot" role="status">AI đang soạn câu trả lời…</div> : null}
          </div>
          {cooldownSeconds > 0 ? <p className="notice notice-warning" role="status">Bạn đã gửi quá nhanh. Có thể gửi lại sau <strong>{cooldownSeconds} giây</strong>.</p> : null}
          {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
          <form className="chat-composer" noValidate onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="ai-chat-message">Tin nhắn cho trợ lý nghề nghiệp</label>
            <div className="field">
              <textarea id="ai-chat-message" className="textarea resize-none" rows={3} value={draft} disabled={!sessionId || pending || cooldownSeconds > 0} placeholder="Hỏi về tìm việc hoặc quy trình ứng tuyển…" aria-invalid={validationAttempted && !!draftValidation.errorCode} aria-describedby="ai-chat-message-count ai-chat-message-error" onChange={(event) => { setDraft(event.target.value); setValidationAttempted(false); }} />
              <p className="character-count" id="ai-chat-message-count">{draftValidation.characterCount.toLocaleString("vi-VN")}/2.000 ký tự</p>
              {validationAttempted && draftValidation.errorMessage ? <p className="form-error" id="ai-chat-message-error" role="alert">{draftValidation.errorMessage}</p> : <span id="ai-chat-message-error" />}
            </div>
            <button className="btn btn-primary" type="submit" disabled={!sessionId || pending || cooldownSeconds > 0}>{pending ? "Đang gửi…" : cooldownSeconds > 0 ? `Chờ ${cooldownSeconds}s` : sessionBusy ? "Thử lại" : "Gửi tin nhắn"}</button>
          </form>
        </section>
        <aside className="panel">
          <p className="eyebrow">LỊCH SỬ TRÒ CHUYỆN</p>
          <h2>Cuộc trò chuyện hiện tại</h2>
          <p className="help">Các tin nhắn hiện chỉ hiển thị trong tab này. Hãy lưu lại thông tin hữu ích trước khi rời trang.</p>
          <p className="notice notice-warning">Tải lại trang hoặc bắt đầu hội thoại mới sẽ xóa các tin nhắn đang hiển thị.</p>
          <button className="btn" type="button" disabled={!sessionId || pending} onClick={startNewConversation}>Bắt đầu hội thoại mới</button>
        </aside>
      </section>
    </main>
  );
}
