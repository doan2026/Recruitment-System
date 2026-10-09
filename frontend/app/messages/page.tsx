"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useCurrentAccount } from "@/components/SessionGate";
import { CandidateShell } from "@/components/CandidateShell";
import { RecruiterShell } from "@/components/RecruiterShell";
import { PageHeader, EmptyState } from "@/components/ui";
import { requestApi } from "@/lib/apiClientCore";
import { useRouter, useSearchParams } from "next/navigation";

interface Conversation {
  id: string;
  title: string;
  is_group: boolean;
  updated_at: string;
  members?: string[];
  avatar_url?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  client_message_id?: string;
}

function ChatInterface({ accountId }: { accountId: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [startingCall, setStartingCall] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fetchRef = useRef<() => void>();

  const searchParams = useSearchParams();
  const router = useRouter();
  const initialChatId = searchParams?.get("chat");

  const formatChatTitle = (title: string) => {
    if (!title) return "Đối tác";
    if (title.startsWith("Chat với ")) {
      const idPart = title.replace("Chat với ", "");
      if (idPart.length > 30) return "Đối tác";
    }
    return title;
  };

  const fetchConversations = useCallback(async () => {
    try {
      const res = await requestApi<Conversation[]>("/chat/chats", { privateData: true });
      const data = res.data || [];
      setConversations(data);
      if (initialChatId && !selectedConv) {
        const match = data.find(c => c.id === initialChatId);
        if (match) setSelectedConv(match);
      }
    } catch (e) {
      console.error("Lỗi khi tải danh sách hội thoại", e);
    } finally {
      setLoading(false);
    }
  }, [initialChatId, selectedConv]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    fetchRef.current = fetchConversations;
  }, [fetchConversations]);

  useEffect(() => {
    if (!selectedConv) return;
    
    let mounted = true;
    setMessages([]);
    setHasMore(true);
    const fetchMessages = async () => {
      try {
        setLoadingMessages(true);
        const res = await requestApi<Message[]>(`/chat/chats/${selectedConv.id}/messages?limit=20`, { privateData: true });
        if (mounted) {
          const data = (res.data || []);
          setMessages(data);
          setHasMore(data.length >= 20);
          
          // Scroll to bottom without smooth immediately on first load
          setTimeout(() => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
            }
          }, 50);
        }
      } catch (e) {
        console.error("Lỗi khi tải tin nhắn", e);
      } finally {
        if (mounted) setLoadingMessages(false);
      }
    };
    fetchMessages();
    return () => { mounted = false; };
  }, [selectedConv]);

  const loadMoreMessages = async () => {
    if (!selectedConv || loadingMessages || !hasMore || messages.length === 0) return;
    try {
      setLoadingMessages(true);
      const oldestMsg = messages[0];
      const res = await requestApi<Message[]>(`/chat/chats/${selectedConv.id}/messages?limit=20&before=${new Date(oldestMsg.created_at).toISOString()}`, { privateData: true });
      const oldData = res.data || [];
      if (oldData.length === 0) {
        setHasMore(false);
        return;
      }
      
      const container = scrollContainerRef.current;
      const previousScrollHeight = container ? container.scrollHeight : 0;

      setMessages(prev => [...oldData, ...prev]);
      setHasMore(oldData.length >= 20);

      // Preserve scroll position
      setTimeout(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - previousScrollHeight;
        }
      }, 0);
    } catch (e) {
      console.error("Lỗi tải thêm tin nhắn", e);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop === 0) {
      loadMoreMessages();
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; 
    const wsUrl = `${protocol}//${host}/api/chat/ws/chat`;
    
    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout;
    let mounted = true;

    const connectWs = () => {
      if (!mounted) return;
      try {
        socket = new WebSocket(wsUrl);
        
        socket.onopen = () => {
          console.log("WebSocket connected");
          setWs(socket);
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "new_message") {
              const msg = data.message as Message;
              setMessages(prev => {
                const exists = prev.some(m => m.id === msg.id || (m.client_message_id && m.client_message_id === msg.client_message_id) || m.id === msg.client_message_id);
                if (exists) {
                  return prev.map(m => (m.id === msg.id || m.id === msg.client_message_id || m.client_message_id === msg.client_message_id) ? msg : m);
                }
                return [...prev, msg];
              });
              setConversations(prev => {
                const idx = prev.findIndex(c => c.id === msg.conversation_id);
                if (idx === -1) {
                  if (fetchRef.current) fetchRef.current();
                  return prev;
                }
                const newConvs = [...prev];
                newConvs[idx] = { ...newConvs[idx], updated_at: msg.created_at };
                return newConvs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
              });
            }
          } catch (e) {
            console.error("Error parsing WS message", e);
          }
        };

        socket.onerror = (e) => {
          console.error("WebSocket error", e);
        };

        socket.onclose = () => {
          console.log("WebSocket closed. Reconnecting in 3s...");
          setWs(null);
          socket = null;
          if (mounted) {
            // Reconnect after 3 seconds
            reconnectTimer = setTimeout(() => {
              // Trigger a small API call to potentially refresh token if expired
              if (fetchRef.current) fetchRef.current();
              connectWs();
            }, 3000);
          }
        };
      } catch (e) {
        console.error("Failed to connect WS", e);
        if (mounted) {
          reconnectTimer = setTimeout(connectWs, 3000);
        }
      }
    };

    connectWs();

    const handleOffline = (e: any) => {
      alert("Người nhận hiện không online để nhận cuộc gọi.");
      setStartingCall(false);
      // We will also use this event in handleStartVideoCall to prevent redirect
    };
    window.addEventListener('video_call_offline', handleOffline);

    return () => {
      mounted = false;
      clearTimeout(reconnectTimer);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      window.removeEventListener('video_call_offline', handleOffline);
    };
  }, []); // Only run once per mount

  useEffect(() => {
    // We only auto-scroll on new incoming message if we are already near the bottom
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
      if (isNearBottom) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: "smooth"
        });
      }
    }

    if (startingCall && messages.length > 0) {
      const latestMsg = messages[messages.length - 1];
      if (latestMsg.content.startsWith("[CALL_ACCEPTED]") && latestMsg.sender_id !== accountId) {
        const callId = latestMsg.content.split(" ")[1];
        setStartingCall(false);
        router.push(`/interviews/${callId}/room?chat=${selectedConv?.id}`);
      } else if (latestMsg.content.startsWith("[CALL_REJECTED]") && latestMsg.sender_id !== accountId) {
        setStartingCall(false);
        alert("Cuộc gọi đã bị từ chối.");
      }
    }
  }, [messages, startingCall, router, accountId]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedConv) return;
    const text = inputText;
    setInputText("");

    try {
      // Optimistic update
      const tempId = globalThis.crypto?.randomUUID?.() || Date.now().toString();
      const newMsg: Message = {
        id: tempId,
        conversation_id: selectedConv.id,
        sender_id: accountId,
        content: text,
        created_at: new Date().toISOString(),
        client_message_id: tempId
      };
      setMessages(prev => [...prev, newMsg]);

      // Call API
      const res = await requestApi<Message>(`/chat/chats/${selectedConv.id}/messages`, {
        method: "POST",
        body: { content: text, client_message_id: tempId },
        privateData: true
      });
      
      // Update with actual message from server
      setMessages(prev => prev.map(m => m.id === tempId || m.client_message_id === tempId ? res.data : m));
    } catch (e) {
      console.error("Failed to send message", e);
    }
  };

  const handleStartVideoCall = async () => {
    if (!selectedConv || !selectedConv.members || startingCall) return;
    
    // Find other members
    const participantIds = selectedConv.members.filter(m => m !== accountId);
    if (participantIds.length === 0) {
      alert("Không có người nhận nào trong cuộc trò chuyện.");
      return;
    }

    setStartingCall(true);
    try {
      // 0. Pre-flight check: is the receiver online?
      const statusRes = await requestApi<{ online: boolean }>(`/notifications/online-status?user_id=${participantIds[0]}`, {
        method: "GET",
        privateData: true
      });

      if (!statusRes.data || !statusRes.data.online) {
        alert("Người nhận hiện không online để nhận cuộc gọi.");
        setStartingCall(false);
        return;
      }

      // 1. Create call in video-service
      const callRes = await requestApi<{ id: string }>("/calls", {
        method: "POST",
        body: {
          title: `Cuộc gọi từ chat`,
          participant_ids: participantIds,
          conversation_id: selectedConv.id
        },
        privateData: true
      });
      
      const callId = callRes.data.id;

      // 2. Send system message in chat
      await requestApi(`/chat/chats/${selectedConv.id}/messages`, {
        method: "POST",
        body: { 
          content: `[CALL_STARTED] ${callId}`, 
          client_message_id: globalThis.crypto?.randomUUID?.() || Date.now().toString() 
        },
        privateData: true
      });

      // Redirect caller to room immediately (waiting room)
      setStartingCall(false);
      router.push(`/interviews/${callId}/room?chat=${selectedConv.id}`);
    } catch (e) {
      console.error("Lỗi khi tạo cuộc gọi video", e);
      alert("Không thể bắt đầu cuộc gọi.");
      setStartingCall(false);
    }
  };

  return (
    <div style={{ height: "calc(100vh - 120px)", display: "flex", border: "1px solid var(--line)", borderRadius: "var(--radius-surface)", background: "white", overflow: "hidden" }}>
      <div style={{ width: 280, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid var(--line)" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Tin nhắn</h3>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)" }}>Đang tải...</div>}
          {!loading && conversations.length === 0 && (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)", fontSize: "0.9rem" }}>Chưa có tin nhắn nào</div>
          )}
          {conversations.map(conv => (
            <div 
              key={conv.id} 
              onClick={() => setSelectedConv(conv)}
              style={{ 
                padding: "12px 16px", 
                borderBottom: "1px solid var(--line)", 
                background: selectedConv?.id === conv.id ? "var(--primary-soft)" : "transparent", 
                cursor: "pointer" 
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                {conv.avatar_url ? (
                  <img src={conv.avatar_url} alt="avatar" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--primary-soft)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "0.9rem", flexShrink: 0 }}>
                    {formatChatTitle(conv.title).charAt(0).toUpperCase()}
                  </div>
                )}
                <strong style={{ display: "block", fontSize: "0.95rem", color: selectedConv?.id === conv.id ? "var(--primary)" : "var(--text)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {formatChatTitle(conv.title)}
                </strong>
              </div>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", display: "block" }}>
                Cập nhật {new Date(conv.updated_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#f8fafc" }}>
        {selectedConv ? (
          <>
            <div style={{ padding: "16px", borderBottom: "1px solid var(--line)", background: "white", display: "flex", alignItems: "center", gap: "12px" }}>
              {selectedConv.avatar_url ? (
                <img src={selectedConv.avatar_url} alt="avatar" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary-soft)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "1rem" }}>
                  {formatChatTitle(selectedConv.title).charAt(0).toUpperCase()}
                </div>
              )}
              <strong style={{ fontSize: "1rem" }}>
                {formatChatTitle(selectedConv.title)}
              </strong>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
                {ws?.readyState !== WebSocket.OPEN && <span style={{ fontSize: "12px", color: "var(--danger)" }}>Chưa kết nối WS</span>}
                <button 
                  className="btn btn-primary"
                  style={{ padding: "6px 12px", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px" }}
                  onClick={handleStartVideoCall}
                  disabled={startingCall}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                  </svg>
                  {startingCall ? "Đang gọi..." : "Video Call"}
                </button>
              </div>
            </div>
            <div 
              ref={scrollContainerRef} 
              onScroll={handleScroll}
              style={{ flex: 1, padding: "16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {loadingMessages && <div style={{textAlign: 'center', padding: '8px', color: 'var(--muted)', fontSize: '0.85rem'}}>Đang tải tin nhắn...</div>}
              {!loadingMessages && messages.length === 0 && (
                <EmptyState
                  title="Chưa có tin nhắn"
                  description="Hãy gửi lời chào để bắt đầu cuộc trò chuyện."
                />
              )}
              {(() => {
                const callStatuses: Record<string, 'ACCEPTED' | 'REJECTED' | 'STARTED' | 'ENDED'> = {};
                messages.forEach(m => {
                  if (m.content.startsWith("[CALL_ACCEPTED] ")) {
                    callStatuses[m.content.split(" ")[1]] = 'ACCEPTED';
                  } else if (m.content.startsWith("[CALL_REJECTED] ")) {
                    callStatuses[m.content.split(" ")[1]] = 'REJECTED';
                  } else if (m.content.startsWith("[CALL_ENDED] ")) {
                    callStatuses[m.content.split(" ")[1]] = 'ENDED';
                  } else if (m.content.startsWith("[CALL_STARTED] ")) {
                    const id = m.content.split(" ")[1];
                    if (!callStatuses[id]) callStatuses[id] = 'STARTED';
                  }
                });

                return messages.map(msg => {
                  const isMe = msg.sender_id === accountId;

                  if (msg.content.startsWith("[CALL_ACCEPTED]") || msg.content.startsWith("[CALL_REJECTED]") || msg.content.startsWith("[CALL_ENDED]")) {
                    return null;
                  }

                  if (msg.content.startsWith("[CALL_STARTED]")) {
                    const callId = msg.content.split(" ")[1];
                    const status = callStatuses[callId] || 'STARTED';

                    if (status === 'ACCEPTED') {
                      return (
                        <div key={msg.id} style={{textAlign: "center", margin: "16px 0"}}>
                          <span style={{background: "#e0f2fe", color: "#0369a1", padding: "6px 14px", borderRadius: "16px", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 500}}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                            Cuộc gọi lúc {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    }
                    
                    if (status === 'REJECTED') {
                      return (
                        <div key={msg.id} style={{textAlign: "center", margin: "16px 0"}}>
                          <span style={{background: "#fee2e2", color: "#b91c1c", padding: "6px 14px", borderRadius: "16px", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 500}}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="22" y1="2" x2="2" y2="22"></line></svg>
                            Cuộc gọi nhỡ lúc {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    }
                    
                    if (status === 'ENDED') {
                      return (
                        <div key={msg.id} style={{textAlign: "center", margin: "16px 0"}}>
                          <span style={{background: "#f1f5f9", color: "#475569", padding: "6px 14px", borderRadius: "16px", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 500}}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                            Cuộc gọi kết thúc lúc {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", margin: "8px 0" }}>
                        <div style={{ maxWidth: "70%", padding: "14px", borderRadius: "16px", background: "var(--primary)", color: "white", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)", borderBottomRightRadius: isMe ? "4px" : "16px", borderBottomLeftRadius: !isMe ? "4px" : "16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                              </svg>
                            </div>
                            <strong style={{ fontSize: "1rem", letterSpacing: "0.2px" }}>Cuộc gọi video</strong>
                          </div>
                          {isMe ? (
                            <span style={{ fontSize: "0.85rem", opacity: 0.9 }}>Đang chờ người nhận...</span>
                          ) : (
                            <a href={`/interviews/${callId}/room?chat=${selectedConv.id}`} style={{ width: "100%", padding: "8px", fontSize: "0.9rem", display: "block", textAlign: "center", textDecoration: "none", background: "white", color: "var(--primary)", borderRadius: "8px", fontWeight: "600" }}>Tham gia ngay</a>
                          )}
                        </div>
                        <span style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", marginBottom: "4px" }}>
                      <div style={{ 
                        maxWidth: "70%", 
                        padding: "10px 14px", 
                        borderRadius: "16px",
                        background: isMe ? "var(--primary)" : "var(--surface)",
                        color: isMe ? "white" : "var(--text)",
                        border: isMe ? "none" : "1px solid var(--line)",
                        borderBottomRightRadius: isMe ? "4px" : "16px",
                        borderBottomLeftRadius: !isMe ? "4px" : "16px",
                        lineHeight: 1.5,
                        fontSize: "0.95rem"
                      }}>
                        {msg.content}
                      </div>
                      <span style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })})()}
            </div>
            <div style={{ padding: "16px", background: "white", borderTop: "1px solid var(--line)" }}>
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                style={{ display: "flex", gap: "8px" }}
              >
                <input 
                  type="text" 
                  className="input" 
                  style={{ flex: 1 }} 
                  placeholder="Nhập tin nhắn..." 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={!inputText.trim()}>Gửi</button>
              </form>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState
              title="Chưa chọn hội thoại"
              description="Chọn một cuộc trò chuyện từ danh sách bên trái để xem tin nhắn."
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const account = useCurrentAccount();

  if (!account) return null;

  if (account.role === "CANDIDATE") {
    return (
      <CandidateShell>
        <ChatInterface accountId={account.id} />
      </CandidateShell>
    );
  }

  if (account.role === "RECRUITER") {
    return (
      <RecruiterShell>
        <ChatInterface accountId={account.id} />
      </RecruiterShell>
    );
  }

  return (
    <main>
      <PageHeader title="Lỗi quyền truy cập" />
      <EmptyState title="Không hỗ trợ" description="Tính năng tin nhắn không dành cho vai trò của bạn." />
    </main>
  );
}
