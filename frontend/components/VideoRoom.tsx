"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";
import { requestApi, toUserMessage } from "@/lib/apiClientCore";
import { sendChatMessage } from "@/lib/chatApi";
import { useCurrentAccount } from "./SessionGate";
import { EmptyState, ErrorState, LoadingState } from "./ui";

interface RoomCredentials {
  token: string;
  livekit_url: string;
  call: { host_id: string; conversation_id: string; status: string };
}

export function VideoRoom({ callId }: { callId: string }) {
  const account = useCurrentAccount();
  const [credentials, setCredentials] = useState<RoomCredentials | null>(null);
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState(false);
  const [revision, setRevision] = useState(0);
  const endingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCredentials(null); setError(""); setDisconnected(false); setEnded(false);
    requestApi<RoomCredentials>(`/calls/${encodeURIComponent(callId)}/join`, {
      method: "POST", privateData: true, signal: controller.signal, maxRetries: 0,
    }).then(response => { if (!controller.signal.aborted) setCredentials(response.data); })
      .catch(failure => { if (!controller.signal.aborted) setError(toUserMessage(failure)); });
    const handleEnded = (event: Event) => {
      if ((event as CustomEvent<{ callId: string }>).detail?.callId !== callId) return;
      setEnded(true); setDisconnected(true);
    };
    const handleOffline = (event: Event) => {
      if ((event as CustomEvent<{ callId: string }>).detail?.callId !== callId) return;
      setError("Người nhận hiện chưa trực tuyến. Bạn có thể nhắn tin để hẹn lại.");
    };
    window.addEventListener("video_call_rejected", handleEnded);
    window.addEventListener("video_call_ended", handleEnded);
    window.addEventListener("video_call_offline", handleOffline);
    return () => {
      controller.abort();
      window.removeEventListener("video_call_rejected", handleEnded);
      window.removeEventListener("video_call_ended", handleEnded);
      window.removeEventListener("video_call_offline", handleOffline);
    };
  }, [callId, revision]);

  async function endCall() {
    if (endingRef.current || !credentials || account?.id !== credentials.call.host_id) return;
    endingRef.current = true; setEnding(true); setError("");
    try {
      await requestApi(`/calls/${encodeURIComponent(callId)}/end`, { method: "POST", privateData: true, maxRetries: 0 });
      if (mounted.current) { setEnded(true); setDisconnected(true); }
      const conversationId = credentials.call.conversation_id;
      if (conversationId) {
        try { await sendChatMessage(conversationId, `[CALL_ENDED] ${callId}`, crypto.randomUUID()); } catch { /* Ending the room already succeeded. */ }
      }
    } catch (failure) { if (mounted.current) setError(toUserMessage(failure)); }
    finally { endingRef.current = false; if (mounted.current) setEnding(false); }
  }

  const backHref = credentials?.call.conversation_id ? `/messages?chat=${encodeURIComponent(credentials.call.conversation_id)}` : "/messages";
  return <section className="stack">
    {error && <ErrorState message={error} onRetry={!credentials ? () => setRevision(value => value + 1) : undefined} />}
    {!credentials && !error && <LoadingState label="Đang chuẩn bị cuộc gọi…" />}
    {credentials && !disconnected && <LiveKitRoom video={false} audio={false} token={credentials.token} serverUrl={credentials.livekit_url}
      data-lk-theme="default" style={{ minHeight: 500, width: "100%" }}
      onError={() => setError("Không thể kết nối camera, micro hoặc phòng gọi. Hãy kiểm tra quyền thiết bị và kết nối mạng.")}
      onDisconnected={() => setDisconnected(true)}>
      <VideoConference /><RoomAudioRenderer />
    </LiveKitRoom>}
    {disconnected && <EmptyState title={ended ? "Cuộc gọi đã kết thúc" : "Bạn đã rời cuộc gọi"}
      description={ended ? "Bạn có thể tiếp tục trao đổi trong tin nhắn." : "Bạn có thể kết nối lại nếu cuộc gọi vẫn đang mở."} />}
    <div className="btn-group">
      <Link className="btn" href={backHref}>Về cuộc trò chuyện</Link>
      {disconnected && !ended && <button className="btn" onClick={() => setRevision(value => value + 1)}>Kết nối lại</button>}
      {credentials?.call.host_id === account?.id && credentials && !ended && <button className="btn btn-warning" disabled={ending} onClick={() => void endCall()}>{ending ? "Đang kết thúc…" : "Kết thúc cuộc gọi cho mọi người"}</button>}
    </div>
  </section>;
}
