import { useEffect, useState, useRef, useCallback } from 'react';
import { Room, RoomEvent, Participant, RemoteTrackPublication, RemoteTrack, Track } from 'livekit-client';

export interface ParticipantTrackInfo {
  identity: string;
  name: string;
  isLocal: boolean;
  videoTrack?: Track;
  audioTrack?: Track;
  isSpeaking: boolean;
}

export const useLiveKitRoom = (url: string, token: string) => {
  const roomRef = useRef<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCamEnabled, setIsCamEnabled] = useState(true);
  const [localVideoTrack, setLocalVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [participants, setParticipants] = useState<Map<string, ParticipantTrackInfo>>(new Map());

  const connectToRoom = useCallback(async () => {
    if (!url || !token) return;

    try {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // Handle room events
      room.on(RoomEvent.Connected, () => {
        setIsConnected(true);
        setError(null);
      });

      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false);
      });

      // Try connecting to LiveKit
      await room.connect(url, token);

      // Enable camera and microphone
      await room.localParticipant.enableCameraAndMicrophone();
      setIsCamEnabled(room.localParticipant.isCameraEnabled);
      setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);

      const localCamPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (localCamPub && localCamPub.track) {
        setLocalVideoTrack(localCamPub.track.mediaStreamTrack);
      }
    } catch (err: any) {
      console.warn('[LiveKit Hook] LiveKit Cloud connection warning:', err);
      // Fallback: If LiveKit cloud key is not set or network failed, start browser getUserMedia for local camera preview
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const videoTrack = stream.getVideoTracks()[0];
        setLocalVideoTrack(videoTrack);
        setIsConnected(true);
        setError('Đang chạy chế độ mô phỏng WebRTC (Cần điền LiveKit Cloud API Key trong .env để kết nối nhiều máy thật)');
      } catch (mediaErr: any) {
        setError('Không thể truy cập Camera/Mic: ' + mediaErr.message);
      }
    }
  }, [url, token]);

  useEffect(() => {
    connectToRoom();

    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (localVideoTrack) {
        localVideoTrack.stop();
      }
    };
  }, [connectToRoom]);

  const toggleCamera = useCallback(async () => {
    if (roomRef.current && roomRef.current.localParticipant) {
      const enabled = !isCamEnabled;
      await roomRef.current.localParticipant.setCameraEnabled(enabled);
      setIsCamEnabled(enabled);
    } else if (localVideoTrack) {
      localVideoTrack.enabled = !localVideoTrack.enabled;
      setIsCamEnabled(localVideoTrack.enabled);
    }
  }, [isCamEnabled, localVideoTrack]);

  const toggleMicrophone = useCallback(async () => {
    if (roomRef.current && roomRef.current.localParticipant) {
      const enabled = !isMicEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);
      setIsMicEnabled(enabled);
    } else {
      setIsMicEnabled(!isMicEnabled);
    }
  }, [isMicEnabled]);

  const leaveRoom = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
    }
    if (localVideoTrack) {
      localVideoTrack.stop();
    }
    setIsConnected(false);
  }, [localVideoTrack]);

  return {
    isConnected,
    error,
    isMicEnabled,
    isCamEnabled,
    localVideoTrack,
    toggleCamera,
    toggleMicrophone,
    leaveRoom,
  };
};
