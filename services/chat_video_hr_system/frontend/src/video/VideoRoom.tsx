import React, { useEffect, useRef } from 'react';
import { useLiveKitRoom } from './useLiveKitRoom';
import { useAuth } from '../auth/AuthProvider';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, AlertCircle, Sparkles } from 'lucide-react';

interface VideoRoomProps {
  callId: string;
  roomName: string;
  token: string;
  livekitUrl: string;
  callTitle?: string;
  onLeave: () => void;
}

export const VideoRoom: React.FC<VideoRoomProps> = ({
  callId,
  roomName,
  token,
  livekitUrl,
  callTitle,
  onLeave,
}) => {
  const { user } = useAuth();
  const {
    isConnected,
    error,
    isMicEnabled,
    isCamEnabled,
    localVideoTrack,
    toggleCamera,
    toggleMicrophone,
    leaveRoom,
  } = useLiveKitRoom(livekitUrl, token);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localVideoTrack) {
      const stream = new MediaStream([localVideoTrack]);
      localVideoRef.current.srcObject = stream;
    }
  }, [localVideoTrack]);

  const handleEndCall = () => {
    leaveRoom();
    onLeave();
  };

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col">
      {/* Top Bar */}
      <div className="h-16 px-6 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
            <VideoIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-white text-sm">{callTitle || 'Phòng phỏng vấn'}</h2>
            <p className="text-xs text-slate-400">Phòng: {roomName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Đang kết nối</span>
        </div>
      </div>

      {/* Warning banner if simulated mode */}
      {error && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-amber-300 text-xs flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Video Viewport */}
      <div className="flex-1 p-6 flex items-center justify-center overflow-hidden">
        <div className="w-full max-w-5xl h-full flex flex-col items-center justify-center relative rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl">
          {/* Local participant video */}
          {localVideoTrack && isCamEnabled ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform -scale-x-100"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-600">
              <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center font-bold text-3xl text-slate-400 mb-4 border border-slate-700">
                {user?.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
              </div>
              <p className="text-sm font-medium text-slate-400">Camera đang tắt</p>
            </div>
          )}

          {/* Participant label overlay */}
          <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-2 border border-white/10">
            <span>{user?.full_name || 'Tôi'} (Chủ phòng)</span>
            {!isMicEnabled && <MicOff className="w-3.5 h-3.5 text-rose-400" />}
          </div>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className="h-20 bg-slate-900/80 border-t border-slate-800 flex items-center justify-center gap-4">
        {/* Toggle Mic */}
        <button
          onClick={toggleMicrophone}
          className={`p-4 rounded-2xl transition shadow-lg ${
            isMicEnabled
              ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
              : 'bg-rose-600/20 border border-rose-500/40 text-rose-400 hover:bg-rose-600/30'
          }`}
          title={isMicEnabled ? 'Tắt Micro' : 'Bật Micro'}
        >
          {isMicEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>

        {/* Toggle Camera */}
        <button
          onClick={toggleCamera}
          className={`p-4 rounded-2xl transition shadow-lg ${
            isCamEnabled
              ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
              : 'bg-rose-600/20 border border-rose-500/40 text-rose-400 hover:bg-rose-600/30'
          }`}
          title={isCamEnabled ? 'Tắt Camera' : 'Bật Camera'}
        >
          {isCamEnabled ? <VideoIcon className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        {/* End Call */}
        <button
          onClick={handleEndCall}
          className="px-6 py-4 rounded-2xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition"
        >
          <PhoneOff className="w-5 h-5" />
          <span>Rời phòng</span>
        </button>
      </div>
    </div>
  );
};
