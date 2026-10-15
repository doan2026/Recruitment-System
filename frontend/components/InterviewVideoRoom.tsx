"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";
import { LoadingState, ErrorState, PageHeader } from "./ui";

export function InterviewVideoRoom({
  interviewId,
  role,
  onLeave
}: {
  interviewId: string;
  role: "CANDIDATE" | "RECRUITER";
  onLeave: () => void;
}) {
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Mô phỏng gọi API lấy token từ video-service (sẽ thay bằng requestApi sau)
    const fetchToken = async () => {
      try {
        // Tạm thời mock logic lấy token (vì backend chưa hỗ trợ trả về token LiveKit thật)
        // Nếu có token thật, ta sẽ truyền vào setToken và setServerUrl.
        // Ở đây cố tình throw để rơi vào màn hình chờ/lỗi gracefully vì không có server thật.
        throw new Error("Tính năng gọi video đang được cấu hình backend. Vui lòng thử lại sau.");
      } catch (err: any) {
        setError(err.message || "Không thể kết nối phòng phỏng vấn.");
      }
    };
    fetchToken();
  }, [interviewId, role]);

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "40px auto" }}>
        <PageHeader title="Phòng Phỏng Vấn" description={`Mã phòng: ${interviewId}`} />
        <ErrorState message={error} onRetry={() => setError("")} />
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={onLeave}>
          Rời phòng
        </button>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <LoadingState label="Đang thiết lập kết nối an toàn P2P..." />
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
      style={{ height: 'calc(100vh - 80px)' }}
      onDisconnected={onLeave}
    >
      <VideoConference />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
