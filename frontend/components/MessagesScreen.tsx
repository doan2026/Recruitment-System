"use client";

import { portalCall, portalSection, type AccountRole } from "@/lib/portalRoutes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentAccount } from "@/components/SessionGate";
import { PageHeader, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { requestApi, toUserMessage } from "@/lib/apiClientCore";
import { listChatMessages, mergeConversationMessages, parseCallMessage, sendChatMessage, type ChatConversation, type ChatMessage } from "@/lib/chatApi";

function ChatInterface({ accountId, role }: { accountId: string; role: AccountRole }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("chat");
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [listError, setListError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revision, setRevision] = useState(0);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const mounted = useRef(true);
  const loadLock = useRef(false);
  const sendLock = useRef(false);
  const callLock = useRef(false);
  const pendingMessage = useRef<{ conversationId: string; content: string; id: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialHistory = useRef(true);
  const scrollToLatest = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  const selected = conversations.find(conversation => conversation.id === selectedId);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fetchConversations = useCallback(async () => {
    setLoading(true); setListError("");
    try {
      const response = await requestApi<ChatConversation[]>("/chat/chats", { privateData: true });
      if (mounted.current) setConversations(response.data ?? []);
    } catch (error) { if (mounted.current) setListError(toUserMessage(error)); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { void fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    setMessages([]); setHasMore(false); setActionError("");
    setInputText(""); pendingMessage.current = null; initialHistory.current = true;
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    setMessageError("");
    loadLock.current = false;
    if (!selectedId) { setLoadingMessages(false); return; }
    setLoadingMessages(true);
    listChatMessages(selectedId, undefined, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      setMessages(current => mergeConversationMessages(selectedId, response.data ?? [], current));
      setHasMore(response.data.length === 20);
      if (initialHistory.current) { initialHistory.current = false; scrollToLatest(); }
    }).catch(error => { if (!controller.signal.aborted) setMessageError(toUserMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingMessages(false); });
    return () => controller.abort();
  }, [selectedId, revision]);

  const loadOlder = async () => {
    if (!selectedId || loadingMessages || !hasMore || loadLock.current || !messages.length) return;
    const conversationId = selectedId;
    loadLock.current = true; setLoadingMessages(true); setMessageError("");
    try {
      // Chat's Go API calls its timestamp boundary `cursor`, not `before`.
      const response = await listChatMessages(conversationId, messages[0].created_at);
      if (!mounted.current || selectedRef.current !== conversationId) return;
      const container = scrollRef.current;
      const oldHeight = container?.scrollHeight ?? 0;
      const oldTop = container?.scrollTop ?? 0;
      setMessages(current => mergeConversationMessages(conversationId, response.data ?? [], current));
      setHasMore(response.data.length === 20);
      requestAnimationFrame(() => {
        if (container && selectedRef.current === conversationId) container.scrollTop = oldTop + container.scrollHeight - oldHeight;
      });
    } catch (error) { if (mounted.current && selectedRef.current === conversationId) setMessageError(toUserMessage(error)); }
    finally {
      if (mounted.current && selectedRef.current === conversationId) { loadLock.current = false; setLoadingMessages(false); }
    }
  };

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const connect = () => {
      if (!active) return;
      const url = new URL("/api/chat/ws/chat", window.location.origin);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => { if (active) { failures = 0; setConnected(true); void fetchConversations(); setRevision(value => value + 1); } };
      socket.onmessage = event => {
        if (!active) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type !== "new_message" || !data.message || typeof data.message.content !== "string") return;
          const message = data.message as ChatMessage;
          const currentId = selectedRef.current;
          if (currentId === message.conversation_id) {
            const container = scrollRef.current;
            const atLatest = !!container && container.scrollHeight - container.scrollTop - container.clientHeight < 150;
            setMessages(current => mergeConversationMessages(currentId, current, [message]));
            if (atLatest) scrollToLatest();
          }
          if (!conversationsRef.current.some(conversation => conversation.id === message.conversation_id)) {
            void fetchConversations();
          } else {
            setConversations(current => current.map(conversation => conversation.id === message.conversation_id
              ? { ...conversation, updated_at: message.created_at } : conversation)
              .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
          }
          const call = parseCallMessage(message.content);
          if (call && message.sender_id !== accountId && ["REJECTED", "ENDED"].includes(call.action)) {
            window.dispatchEvent(new CustomEvent("video_call_signal", { detail: { callId: call.callId, action: call.action } }));
          }
        } catch { /* Ignore malformed stream frames; HTTP remains authoritative. */ }
      };
      socket.onerror = () => { if (active) setConnected(false); };
      socket.onclose = () => {
        if (!active) return;
        setConnected(false);
        reconnectTimer = setTimeout(async () => {
          await fetchConversations(); // Allows the common auth refresh hook to recover an expired cookie.
          connect();
        }, Math.min(30000, 3000 * 2 ** failures++));
      };
    };
    connect();
    return () => { active = false; clearTimeout(reconnectTimer); socket?.close(); };
  }, [accountId, fetchConversations]);

  // HTTP catch-up keeps chat usable when a deployment cannot upgrade WebSockets.
  useEffect(() => {
    if (connected || !selectedId) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      listChatMessages(selectedId, undefined, controller.signal).then(response => {
        if (!controller.signal.aborted) setMessages(current => mergeConversationMessages(selectedId, current, response.data ?? []));
      }).catch(() => {});
    }, 10000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [connected, selectedId]);

  async function send() {
    if (!selectedId || !inputText.trim() || sendLock.current) return;
    const conversationId = selectedId;
    const content = inputText.trim();
    const previous = pendingMessage.current;
    const attempt = previous?.conversationId === conversationId && previous.content === content
      ? previous : { conversationId, content, id: crypto.randomUUID() };
    pendingMessage.current = attempt;
    sendLock.current = true; setSending(true); setActionError("");
    try {
      const response = await sendChatMessage(conversationId, content, attempt.id);
      if (!mounted.current || selectedRef.current !== conversationId) return;
      setMessages(current => mergeConversationMessages(conversationId, current, [response.data]));
      setInputText(""); pendingMessage.current = null;
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    } catch (error) {
      if (mounted.current && selectedRef.current === conversationId) setActionError(`${toUserMessage(error)} Nội dung vẫn được giữ để bạn gửi lại.`);
    } finally { sendLock.current = false; if (mounted.current) setSending(false); }
  }

  async function startCall() {
    if (!selected || callLock.current) return;
    const participantIds = (selected.members ?? []).filter(id => id !== accountId);
    if (!participantIds.length) { setActionError("Chưa xác định được người nhận. Hãy tải lại hội thoại."); return; }
    const conversationId = selected.id;
    callLock.current = true; setStartingCall(true); setActionError("");
    try {
      const response = await requestApi<{ id: string }>("/calls", {
        method: "POST", privateData: true, maxRetries: 0,
        body: { title: "Cuộc gọi từ tin nhắn", participant_ids: participantIds, conversation_id: conversationId },
      });
      // The room already exists; a chat delivery failure must not create a second call.
      try { await sendChatMessage(conversationId, `[CALL_STARTED] ${response.data.id}`, crypto.randomUUID()); } catch { /* The call event also notifies invited members. */ }
      if (mounted.current) router.push(`${portalCall(role, response.data.id)}?chat=${encodeURIComponent(conversationId)}`);
    } catch (error) { if (mounted.current) setActionError(toUserMessage(error)); }
    finally { callLock.current = false; if (mounted.current) setStartingCall(false); }
  }

  return <main>
    <PageHeader eyebrow="TRAO ĐỔI" title="Tin nhắn" description="Trao đổi với ứng viên và nhà tuyển dụng trong từng cuộc trò chuyện." />
    <div className="messages-workspace card" style={{ padding: 0, overflow: "hidden" }}>
      <section className="messages-list" aria-label="Danh sách hội thoại">
        <div className="stack" style={{ padding: 16 }}>
          <h2>Cuộc trò chuyện</h2>
          <button className="btn" type="button" onClick={() => void fetchConversations()} disabled={loading}>Tải lại hội thoại</button>
          {loading && <LoadingState />}
          {listError && <ErrorState message={listError} onRetry={() => void fetchConversations()} />}
          {!loading && !listError && !conversations.length && <EmptyState title="Chưa có cuộc trò chuyện" description="Mở hồ sơ ứng tuyển để bắt đầu trao đổi." />}
        </div>
        {conversations.map(conversation => <button key={conversation.id} type="button"
          className="btn" aria-pressed={selectedId === conversation.id}
          onClick={() => router.replace(`${portalSection(role, "messages")}?chat=${encodeURIComponent(conversation.id)}`, { scroll: false })}
          style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, whiteSpace: "normal", overflowWrap: "anywhere", padding: 16, background: selectedId === conversation.id ? "var(--primary-soft)" : "var(--surface)" }}>
          <strong>{conversation.title || "Đối tác"}</strong><br />
          <small className="muted">Cập nhật {new Date(conversation.updated_at).toLocaleDateString("vi-VN")}</small>
        </button>)}
      </section>
      <section className="messages-thread" aria-label="Nội dung cuộc trò chuyện">
        {selectedId ? <>
          <div className="section-head" style={{ padding: 16, marginBottom: 0, borderBottom: "1px solid var(--line)" }}>
            <div><h2>{selected?.title || "Cuộc trò chuyện"}</h2>
              <small className="muted" role="status">{connected ? "Đã kết nối" : "Đang kết nối lại · Tin nhắn cập nhật định kỳ"}</small></div>
            <button className="btn btn-primary" type="button" onClick={() => void startCall()} disabled={!selected || startingCall}>{startingCall ? "Đang tạo cuộc gọi…" : "Gọi video"}</button>
          </div>
          <div ref={scrollRef} style={{ flex: 1, minHeight: 240, overflowY: "auto", padding: 16 }} aria-label="Tin nhắn trong hội thoại">
            {hasMore && <button className="btn" type="button" disabled={loadingMessages} onClick={() => void loadOlder()}>Tải tin nhắn cũ</button>}
            {loadingMessages && <LoadingState />}
            {messageError && <ErrorState message={messageError} onRetry={() => hasMore ? void loadOlder() : setRevision(value => value + 1)} />}
            {!loadingMessages && !messageError && !messages.length && <EmptyState title="Chưa có tin nhắn" description="Gửi lời chào để bắt đầu cuộc trò chuyện." />}
            {messages.map(message => {
              const call = parseCallMessage(message.content);
              if (call && call.action !== "STARTED") return null;
              const isMe = message.sender_id === accountId;
              return <article key={message.id} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", margin: "12px 0" }}>
                <div style={{ maxWidth: "85%", padding: "10px 14px", borderRadius: 12, background: isMe ? "var(--primary)" : "var(--surface-2)", color: isMe ? "white" : "var(--text)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {call ? <div className="stack"><strong>Cuộc gọi video</strong><span>Đã gửi lời mời gọi</span>
                    <a className="btn" href={`${portalCall(role, call.callId)}?chat=${encodeURIComponent(selectedId)}`}>Mở cuộc gọi</a></div> : message.content}
                </div>
                <time className="muted" style={{ fontSize: "0.75rem", marginTop: 4 }} dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</time>
              </article>;
            })}
          </div>
          <form noValidate onSubmit={event => { event.preventDefault(); void send(); }} className="stack" style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
            {actionError && <p role="alert" className="form-error">{actionError}</p>}
            <label className="field" htmlFor="chat-message">Nội dung tin nhắn</label>
            <div style={{ display: "flex", gap: 8 }}><input id="chat-message" className="input" style={{ flex: 1, minWidth: 0 }} value={inputText} disabled={sending} onChange={event => setInputText(event.target.value)} placeholder="Nhập tin nhắn…" />
              <button className="btn btn-primary" type="submit" disabled={sending || loadingMessages || !inputText.trim()}>{sending ? "Đang gửi…" : "Gửi"}</button></div>
          </form>
        </> : <EmptyState title="Chọn cuộc trò chuyện" description="Chọn một hội thoại để xem và gửi tin nhắn." />}
      </section>
    </div>
  </main>;
}

export default function MessagesScreen() {
  const account = useCurrentAccount();
  if (account?.role === "CANDIDATE" || account?.role === "RECRUITER") return <ChatInterface key={account.id} accountId={account.id} role={account.role} />;
  return <LoadingState />;
}
