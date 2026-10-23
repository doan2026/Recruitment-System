"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentAccount } from "./SessionGate";
import { requestApi, toUserMessage } from "@/lib/apiClientCore";
import { parseCallMessage, sendChatMessage } from "@/lib/chatApi";
import { mergeNotifications, type InboxNotification } from "@/lib/notificationState";
import { portalCall } from "@/lib/portalRoutes";
export type Notification = InboxNotification;

interface NotificationContextValue {
  unreadCount: number;
  notifications: Notification[];
  hasMore: boolean;
  loading: boolean;
  error: string;
  marking: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}
const NotificationContext = createContext<NotificationContextValue | null>(null);
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used within a NotificationProvider");
  return context;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  const accountId = account?.id;
  const pathname = usePathname();
  const inboxVisible = useRef(false);
  inboxVisible.current = /^\/(candidate|recruiter|admin)\/notifications$/.test(pathname);
  const [inboxOwner, setInboxOwner] = useState(accountId);
  const identity = useRef(accountId);
  identity.current = accountId;
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const notificationRevision = useRef(0);
  const notificationUpdates = useRef(new Map<string, { revision: number; notification: Notification }>());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ callId: string; conversationId: string; title: string } | null>(null);
  const [callPending, setCallPending] = useState(false);
  const [callError, setCallError] = useState("");
  const loadLock = useRef(false);
  const mutationLock = useRef(false);
  const callLock = useRef(false);
  const countRevision = useRef(0);
  const isCurrent = useCallback(() => !!accountId && identity.current === accountId, [accountId]);

  // GET snapshots may finish after a live update or successful read action.
  // Overlay only updates observed after that GET started, without changing its cursor.
  const recordUpdates = useCallback((updates: Notification[]) => {
    for (const notification of updates) {
      notificationUpdates.current.set(notification.id, { revision: ++notificationRevision.current, notification });
    }
    notificationsRef.current = mergeNotifications(notificationsRef.current, updates);
    setNotifications(notificationsRef.current);
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    if (!isCurrent()) return;
    const revision = ++countRevision.current;
    try {
      const response = await requestApi<{ unread_count: number }>("/api/notifications/unread-count", { privateData: true });
      if (isCurrent() && revision === countRevision.current) setUnreadCount(response.data.unread_count);
    } catch { /* Inbox read failures are shown by refresh; keep the last known count. */ }
  }, [isCurrent]);

  const refresh = useCallback(async () => {
    if (!isCurrent() || loadLock.current) return;
    loadLock.current = true; setLoading(true); setError("");
    const startedAt = notificationRevision.current;
    try {
      const response = await requestApi<Notification[]>("/api/notifications", { privateData: true });
      if (!isCurrent()) return;
      const overlay = [...notificationUpdates.current.values()].filter(update => update.revision > startedAt).map(update => update.notification);
      notificationsRef.current = mergeNotifications(response.data ?? [], overlay);
      setNotifications(notificationsRef.current);
      setNextCursor(response.meta?.nextCursor ?? null);
      await fetchUnreadCount();
    } catch (failure) { if (isCurrent()) setError(toUserMessage(failure)); }
    finally { if (isCurrent()) { loadLock.current = false; setLoading(false); } }
  }, [isCurrent, fetchUnreadCount]);

  async function loadMore() {
    if (!isCurrent() || loadLock.current || !nextCursor) return;
    loadLock.current = true; setLoading(true); setError("");
    const startedAt = notificationRevision.current;
    try {
      const response = await requestApi<Notification[]>("/api/notifications", { privateData: true, query: { cursor: nextCursor } });
      if (isCurrent()) {
        const overlay = [...notificationUpdates.current.values()].filter(update => update.revision > startedAt).map(update => update.notification);
        notificationsRef.current = mergeNotifications(mergeNotifications(notificationsRef.current, response.data ?? []), overlay);
        setNotifications(notificationsRef.current);
        setNextCursor(response.meta?.nextCursor ?? null);
      }
    } catch (failure) { if (isCurrent()) setError(toUserMessage(failure)); }
    finally { if (isCurrent()) { loadLock.current = false; setLoading(false); } }
  }

  async function markAsRead(id: string) {
    if (!isCurrent() || mutationLock.current || notifications.find(notification => notification.id === id)?.is_read) return;
    mutationLock.current = true; setMarking(true); setError("");
    try {
      await requestApi(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", privateData: true, maxRetries: 0 });
      if (isCurrent()) {
        const latest = notificationsRef.current.find(notification => notification.id === id);
        if (latest) recordUpdates([{ ...latest, is_read: true }]);
      }
      await fetchUnreadCount();
    } catch (failure) { if (isCurrent()) setError(toUserMessage(failure)); }
    finally { if (isCurrent()) { mutationLock.current = false; setMarking(false); } }
  }

  async function markAllAsRead() {
    if (!isCurrent() || mutationLock.current) return;
    const visibleIds = new Set(notifications.map(notification => notification.id));
    mutationLock.current = true; setMarking(true); setError("");
    try {
      await requestApi("/api/notifications/read-all", { method: "PATCH", privateData: true, maxRetries: 0 });
      if (isCurrent()) {
        const updates = [...visibleIds].flatMap(id => {
          const latest = notificationsRef.current.find(notification => notification.id === id);
          return latest ? [{ ...latest, is_read: true }] : [];
        });
        recordUpdates(updates);
      }
      await fetchUnreadCount();
    } catch (failure) { if (isCurrent()) setError(toUserMessage(failure)); }
    finally { if (isCurrent()) { mutationLock.current = false; setMarking(false); } }
  }

  useEffect(() => {
    identity.current = accountId;
    notificationUpdates.current.clear(); notificationRevision.current = 0; notificationsRef.current = [];
    setNotifications([]); setUnreadCount(0); setNextCursor(null); setIncomingCall(null); setError("");
    loadLock.current = false; mutationLock.current = false; callLock.current = false;
    setMarking(false); setCallPending(false); setLoading(false); setCallError("");
    setInboxOwner(accountId);
    if (accountId) void fetchUnreadCount();
    return () => { identity.current = undefined; ++countRevision.current; };
  }, [accountId, fetchUnreadCount]);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const verifyCallSignal = async (call: { callId: string; action: "ENDED" | "REJECTED" }) => {
      if (!active || !isCurrent()) return;
      try {
        const response = await requestApi<{ id: string }[]>("/api/calls", { privateData: true, maxRetries: 0 });
        const calls = response.data;
        // Chat content is user-authored. Only Video can establish that a call is closed.
        // This endpoint is capped at 50; absence in a full page proves nothing.
        if (!active || !isCurrent() || !Array.isArray(calls) || calls.length >= 50
          || calls.some(item => !item || typeof item.id !== "string" || item.id === call.callId)) return;
        window.dispatchEvent(new CustomEvent(call.action === "REJECTED" ? "video_call_rejected" : "video_call_ended", { detail: { callId: call.callId } }));
        setIncomingCall(current => current?.callId === call.callId ? null : current);
      } catch { /* Keep the room and invitation open when Video state is unavailable. */ }
    };
    const handleCallSignal = (event: Event) => {
      const detail = (event as CustomEvent<{ callId?: unknown; action?: unknown }>).detail;
      if (typeof detail?.callId !== "string" || (detail.action !== "ENDED" && detail.action !== "REJECTED")) return;
      const call = parseCallMessage(`[CALL_${detail.action}] ${detail.callId}`);
      if (call) void verifyCallSignal({ callId: call.callId, action: detail.action });
    };
    window.addEventListener("video_call_signal", handleCallSignal);
    // Authentication cookies belong to the frontend origin, including SSE reconnects.
    const source = new EventSource("/api/notifications/stream", { withCredentials: true });
    source.addEventListener("notification", event => {
      if (!isCurrent()) return;
      try {
        const notification = JSON.parse((event as MessageEvent).data) as Notification;
        if (typeof notification.id !== "string" || typeof notification.body !== "string") return;
        if (notification.type !== "VIDEO_CALL_OFFLINE") {
          recordUpdates([notification]);
          void fetchUnreadCount(); // Chat notifications are upserts; receiving one does not imply +1.
        }
        const callId = notification.metadata?.call_id;
        const conversationId = notification.metadata?.conversation_id;
        if (notification.type === "video_call" && typeof callId === "string" && typeof conversationId === "string") {
          setIncomingCall({ callId, conversationId, title: notification.title }); setCallError("");
        }
        if (notification.type === "VIDEO_CALL_OFFLINE" && typeof callId === "string") {
          window.dispatchEvent(new CustomEvent("video_call_offline", { detail: { callId } }));
        }
        const call = parseCallMessage(notification.body);
        if (call && (call.action === "REJECTED" || call.action === "ENDED")) {
          void verifyCallSignal({ callId: call.callId, action: call.action });
        }
      } catch { /* Ignore malformed stream data; the inbox can always be refreshed. */ }
    });
    source.addEventListener("connected", () => {
      // Reconcile missed events after reconnect only when the inbox is open.
      if (inboxVisible.current) void refresh();
      else void fetchUnreadCount();
    });
    const poll = setInterval(() => { if (document.visibilityState === "visible") void fetchUnreadCount(); }, 30000);
    return () => { active = false; source.close(); clearInterval(poll); window.removeEventListener("video_call_signal", handleCallSignal); };
  }, [accountId, isCurrent, fetchUnreadCount, refresh, recordUpdates]);

  async function respondToCall(accept: boolean) {
    if (!incomingCall || callLock.current) return;
    const call = incomingCall;
    callLock.current = true; setCallPending(true); setCallError("");
    try {
      if (!accept) await requestApi(`/api/calls/${encodeURIComponent(call.callId)}/reject`, { method: "POST", privateData: true, maxRetries: 0 });
      try { await sendChatMessage(call.conversationId, `[CALL_${accept ? "ACCEPTED" : "REJECTED"}] ${call.callId}`, crypto.randomUUID()); } catch { /* Call authorization stays in Video service. */ }
      if (!isCurrent()) return;
      setIncomingCall(null);
      if (accept) router.push(`${portalCall(account?.role ?? "CANDIDATE", call.callId)}?chat=${encodeURIComponent(call.conversationId)}`);
    } catch (failure) { if (isCurrent()) setCallError(toUserMessage(failure)); }
    finally { if (isCurrent()) { callLock.current = false; setCallPending(false); } }
  }

  // The provider survives navigation. Hide the previous owner's state in the
  // render that precedes the identity-reset effect, including incoming calls.
  const ownsInbox = !!accountId && inboxOwner === accountId;
  return <NotificationContext.Provider value={{ unreadCount: ownsInbox ? unreadCount : 0, notifications: ownsInbox ? notifications : [], hasMore: ownsInbox && !!nextCursor, loading: ownsInbox ? loading : !!accountId, error: ownsInbox ? error : "", marking: ownsInbox && marking, refresh, loadMore, markAsRead, markAllAsRead }}>
    {children}
    {ownsInbox && incomingCall && <aside className="card stack" role="region" aria-label="Cuộc gọi đến" style={{ position: "fixed", bottom: 20, right: 20, width: "min(340px, calc(100vw - 40px))", zIndex: 9999 }}>
      <strong>{incomingCall.title}</strong><p role="status">Bạn có lời mời tham gia cuộc gọi video.</p>
      {callError && <p className="form-error" role="alert">{callError}</p>}
      <div className="btn-group"><button className="btn" disabled={callPending} onClick={() => void respondToCall(false)}>Từ chối</button>
        <button className="btn btn-primary" disabled={callPending} onClick={() => void respondToCall(true)}>{callPending ? "Đang xử lý…" : "Chấp nhận"}</button></div>
    </aside>}
  </NotificationContext.Provider>;
}
