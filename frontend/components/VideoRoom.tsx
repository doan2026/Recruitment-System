"use client";

import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { requestApi } from "@/lib/apiClientCore";
import { useSearchParams } from "next/navigation";

interface VideoRoomProps {
  callId: string;
}

export function VideoRoom({ callId }: VideoRoomProps) {
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  
  const searchParams = useSearchParams();
  const chatId = searchParams ? searchParams.get("chat") : null;

  useEffect(() => {
    let mounted = true;

    async function joinRoom() {
      try {
        const res = await requestApi<{ token: string, livekit_url: string }>(`/calls/${callId}/join`, {
          method: "POST",
          privateData: true,
        });
        
        if (mounted) {
          setToken(res.data.token);
          setServerUrl(res.data.livekit_url);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to join video room");
        }
      }
    }

    joinRoom();

    const handleCallRejected = (e: any) => {
      if (e.detail?.callId === callId) {
        if (mounted) {
          setError("Cuộc gọi đã bị từ chối hoặc người dùng không khả dụng.");
          setDisconnected(true);
        }
      }
    };
    
    const handleCallEnded = (e: any) => {
      if (e.detail?.callId === callId) {
        if (mounted) {
          setDisconnected(true);
        }
      }
    };

    window.addEventListener('video_call_rejected', handleCallRejected);
    window.addEventListener('video_call_offline', handleCallRejected);
    window.addEventListener('video_call_ended', handleCallEnded);

    return () => {
      mounted = false;
      window.removeEventListener('video_call_rejected', handleCallRejected);
      window.removeEventListener('video_call_offline', handleCallRejected);
      window.removeEventListener('video_call_ended', handleCallEnded);
    };
  }, [callId]);

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-mark" style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger)" }}>
          ×
        </div>
        <h3>Lỗi kết nối phòng phỏng vấn</h3>
        <p className="form-error">{error}</p>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>Đang chuẩn bị phòng phỏng vấn...</p>
      </div>
    );
  }

  if (disconnected) {
    return (
      <div className="empty-state" style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "500px", background: "var(--surface)", borderRadius: "16px", border: "1px solid var(--line)" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--line)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", color: "var(--muted)" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
            <line x1="23" y1="1" x2="1" y2="23"></line>
          </svg>
        </div>
        <h3 style={{ margin: "0 0 8px 0" }}>Cuộc gọi đã kết thúc</h3>
        <p style={{ color: "var(--muted)", margin: "0 0 24px 0" }}>Cảm ơn bạn đã tham gia.</p>
        <button className="btn btn-primary" onClick={() => window.location.href = "/"}>Về trang chủ</button>
      </div>
    );
  }

  return (
    <LiveKitRoom
      video={true}
      audio={true}
      token={token}
      serverUrl={serverUrl}
      data-lk-theme="default"
      style={{ height: "100%", width: "100%", minHeight: "500px", borderRadius: "16px", overflow: "hidden", border: "1px solid var(--line)" }}
      onDisconnected={() => {
        setDisconnected(true);
        
        // Chạy ngầm các request dọn dẹp API để không block UI unmount
        (async () => {
          try {
            await requestApi(`/calls/${callId}/end`, { method: "POST", privateData: true });
            if (chatId) {
              await requestApi(`/chat/chats/${chatId}/messages`, {
                method: "POST",
                body: { 
                  content: `[CALL_ENDED] ${callId}`, 
                  client_message_id: globalThis.crypto?.randomUUID?.() || Date.now().toString() 
                },
                privateData: true
              });
            }
          } catch (e) {
            // ignore error if not host
          }
        })();
      }}
    >
      <VideoConference />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
