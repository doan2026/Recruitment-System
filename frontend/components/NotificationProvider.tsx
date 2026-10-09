"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useCurrentAccount } from "./SessionGate";
import { requestApi } from "@/lib/apiClientCore";
import { useRouter } from "next/navigation";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  metadata?: any;
}

interface NotificationContextValue {
  unreadCount: number;
  notifications: Notification[];
  hasMore: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationProvider");
  return ctx;
};

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const account = useCurrentAccount();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [incomingCall, setIncomingCall] = useState<{ callId: string, title: string, body: string, conversationId: string } | null>(null);
  const [toastNotifs, setToastNotifs] = useState<Notification[]>([]);
  const router = useRouter();

  const fetchUnreadCount = async () => {
    try {
      const res = await requestApi<{ unread_count: number }>("/notifications/unread-count", { privateData: true });
      setUnreadCount(res.data.unread_count);
    } catch (e) {
      console.error("Failed to fetch unread count", e);
    }
  };

  const loadMore = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await requestApi<Notification[]>("/notifications", {
        privateData: true,
        query: nextCursor ? { cursor: nextCursor } : {},
      });
      setNotifications(prev => [...prev, ...res.data]);
      setNextCursor(res.meta?.nextCursor ?? null);
      setHasMore(!!res.meta?.nextCursor);
    } catch (e) {
      console.error("Failed to load notifications", e);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await requestApi<Notification[]>("/notifications", { privateData: true });
      setNotifications(res.data);
      setNextCursor(res.meta?.nextCursor ?? null);
      setHasMore(!!res.meta?.nextCursor);
    } catch (e) {
      console.error("Failed to fetch notifications", e);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await requestApi(`/notifications/${id}/read`, { method: "PATCH", privateData: true });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await requestApi("/notifications/read-all", { method: "PATCH", privateData: true });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error("Failed to mark all as read", e);
    }
  };

  // Initial load
  useEffect(() => {
    if (!account) return;
    fetchUnreadCount();
    refresh();
  }, [account]);

  // Setup EventSource for real-time updates
  useEffect(() => {
    if (!account) return;
    
    // Check if running in browser
    if (typeof window === "undefined") return;
    
    // We append the access token to URL if possible or let the gateway handle cookie.
    // Assuming gateway handles cookie/auth for SSE.
    // Bypassing Next.js proxy because Next.js rewrites buffer the SSE stream indefinitely.
    const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const evtSourceUrl = isLocal 
      ? `http://${window.location.hostname}:8080/notifications/stream` 
      : "/api/notifications/stream";
    const evtSource = new EventSource(evtSourceUrl, { withCredentials: true });
    
    evtSource.addEventListener("notification", (event) => {
      try {
        const notif = JSON.parse(event.data) as Notification;
        setNotifications(prev => [notif, ...prev]);
        setUnreadCount(prev => prev + 1);

        // Show toast
        if (notif.type !== "video_call" && notif.type !== "VIDEO_CALL_OFFLINE") {
          setToastNotifs(prev => [...prev, notif]);
          setTimeout(() => {
            setToastNotifs(prev => prev.filter(n => n.id !== notif.id));
          }, 5000);
        }
        
        // Handle incoming video call
        if (notif.type === "video_call") {
          const callId = notif.metadata?.call_id;
          const conversationId = notif.metadata?.conversation_id;
          if (callId && conversationId) {
            setIncomingCall({ callId, title: notif.title, body: notif.body || "Bạn có cuộc gọi đến", conversationId });
          }
        }
        
        // Handle offline video call receiver
        if (notif.type === "VIDEO_CALL_OFFLINE") {
          const callId = notif.metadata?.call_id;
          // Here we can dispatch a custom event to tell the page that the call failed
          if (callId && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent('video_call_offline', { detail: { callId } }));
          }
        }
        
        // Handle CALL_REJECTED message notification
        if (notif.type === "new_message" && notif.body?.startsWith("[CALL_REJECTED]")) {
          const callId = notif.body.split(" ")[1];
          if (callId && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent('video_call_rejected', { detail: { callId } }));
          }
        }
        
        // Handle CALL_ENDED message notification
        if (notif.type === "new_message" && notif.body?.startsWith("[CALL_ENDED]")) {
          const callId = notif.body.split(" ")[1];
          if (callId && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent('video_call_ended', { detail: { callId } }));
          }
          setIncomingCall(prev => (prev && prev.callId === callId) ? null : prev);
        }
      } catch (e) {
        console.error("Failed to parse SSE", e);
      }
    });

    evtSource.addEventListener("read_all", () => {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    });

    return () => {
      evtSource.close();
    };
  }, [account]);

  // Timeout for incoming call (20s)
  useEffect(() => {
    if (!incomingCall) return;
    const timer = setTimeout(async () => {
      try {
        await requestApi(`/chat/chats/${incomingCall.conversationId}/messages`, {
          method: "POST",
          body: { 
            content: `[CALL_REJECTED] ${incomingCall.callId}`, 
            client_message_id: globalThis.crypto?.randomUUID?.() || Date.now().toString() 
          },
          privateData: true
        });
        await requestApi(`/calls/${incomingCall.callId}/reject`, { method: "POST", privateData: true });
      } catch (e) { console.error("Reject err", e); }
      setIncomingCall(null);
    }, 20000); // 20 seconds timeout

    return () => clearTimeout(timer);
  }, [incomingCall]);

  return (
    <NotificationContext.Provider value={{ unreadCount, notifications, hasMore, loading, refresh, loadMore, markAsRead, markAllAsRead }}>
      {children}
      {incomingCall && (
        <div style={{
          position: "fixed",
          top: "20px", right: "20px",
          zIndex: 9999,
          animation: "slideIn 0.3s ease-out forwards"
        }}>
          <div style={{
            background: "white",
            padding: "16px",
            borderRadius: "12px",
            width: "320px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
            border: "1px solid var(--line)"
          }}>
            <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%", background: "var(--primary-soft)", 
                color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <div style={{ overflow: "hidden" }}>
                <h4 style={{ margin: "0 0 4px 0", fontSize: "1rem", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{incomingCall.title}</h4>
                <p style={{ color: "var(--muted)", margin: "0", fontSize: "0.85rem", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{incomingCall.body}</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1, borderColor: "var(--danger)", color: "var(--danger)", padding: "6px" }}
                onClick={async () => {
                  try {
                    await requestApi(`/chat/chats/${incomingCall.conversationId}/messages`, {
                      method: "POST",
                      body: { 
                        content: `[CALL_REJECTED] ${incomingCall.callId}`, 
                        client_message_id: globalThis.crypto?.randomUUID?.() || Date.now().toString() 
                      },
                      privateData: true
                    });
                    await requestApi(`/calls/${incomingCall.callId}/reject`, { method: "POST", privateData: true });
                  } catch (e) { console.error("Reject err", e); }
                  setIncomingCall(null);
                }}
              >
                Từ chối
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1, background: "var(--primary-2)", borderColor: "var(--primary-2)", padding: "6px" }}
                onClick={async () => {
                  try {
                    await requestApi(`/chat/chats/${incomingCall.conversationId}/messages`, {
                      method: "POST",
                      body: { 
                        content: `[CALL_ACCEPTED] ${incomingCall.callId}`, 
                        client_message_id: globalThis.crypto?.randomUUID?.() || Date.now().toString() 
                      },
                      privateData: true
                    });
                  } catch (e) { console.error("Accept err", e); }
                  setIncomingCall(null);
                  router.push(`/interviews/${incomingCall.callId}/room`);
                }}
              >
                Chấp nhận
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        pointerEvents: "none"
      }}>
        {toastNotifs.map(toast => (
          <div key={toast.id} style={{
            background: "white",
            border: "1px solid var(--line)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            padding: "16px",
            borderRadius: "8px",
            width: "320px",
            pointerEvents: "auto",
            animation: "slideIn 0.3s ease-out forwards",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            borderLeft: "4px solid var(--primary)"
          }}>
            <strong style={{ fontSize: "0.95rem" }}>{toast.title}</strong>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
              {toast.body}
            </span>
          </div>
        ))}
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}} />
    </NotificationContext.Provider>
  );
};
