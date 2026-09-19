import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { Navbar } from './components/Navbar';
import { ChatList } from './chat/ChatList';
import { ChatWindow } from './chat/ChatWindow';
import { useChatSocket } from './chat/useChatSocket';
import { Conversation, Message, chatApi } from './api/chat';
import { videoApi } from './api/video';
import { VideoCallDashboard } from './video/VideoCallDashboard';
import { VideoRoom } from './video/VideoRoom';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const { user, loading } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [currentTab, setCurrentTab] = useState<'chat' | 'video'>('chat');

  // Chat State
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Active Video Call State
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    roomName: string;
    token: string;
    livekitUrl: string;
    title: string;
  } | null>(null);

  // Realtime WebSocket message handler
  const handleNewMessage = useCallback((newMsg: Message) => {
    if (selectedConversation && newMsg.conversation_id === selectedConversation.id) {
      setMessages((prev) => {
        // Check if an optimistic message with this client_message_id already exists
        const existingIndex = prev.findIndex(
          (m) =>
            (m.client_message_id && m.client_message_id === newMsg.client_message_id) ||
            m.id === newMsg.id
        );

        if (existingIndex !== -1) {
          // Replace optimistic message with confirmed server message
          const updated = [...prev];
          updated[existingIndex] = newMsg;
          return updated;
        }

        return [...prev, newMsg];
      });
    }
  }, [selectedConversation]);

  const { connected: isWsConnected, sendMessage: sendWsMessage } = useChatSocket(handleNewMessage);

  // Fetch messages when conversation changes
  useEffect(() => {
    if (!selectedConversation) return;

    const fetchMessages = async () => {
      setLoadingMessages(true);
      try {
        const msgs = await chatApi.listMessages(selectedConversation.id, 50);
        setMessages(msgs || []);
      } catch (err) {
        console.error('Failed to load messages', err);
      } finally {
        setLoadingMessages(false);
      }
    };

    fetchMessages();
  }, [selectedConversation]);

  // Send message action (WS with REST fallback)
  const handleSendMessage = async (content: string) => {
    if (!selectedConversation) return;

    const clientMsgId = crypto.randomUUID();
    // Optimistic UI update
    const optimisticMsg: Message = {
      id: clientMsgId,
      conversation_id: selectedConversation.id,
      sender_id: user?.id || '',
      client_message_id: clientMsgId,
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    const sent = sendWsMessage(selectedConversation.id, content, clientMsgId);
    if (!sent) {
      // Fallback REST if WS not open
      try {
        await chatApi.sendMessage(selectedConversation.id, content, clientMsgId);
      } catch (err) {
        console.error('Failed to send message via REST fallback', err);
      }
    }
  };

  // Join video call action
  const handleJoinCall = async (callId: string, roomName: string, title: string) => {
    try {
      const res = await videoApi.joinCall(callId);
      setActiveCall({
        callId,
        roomName: res.room_name || roomName,
        token: res.token,
        livekitUrl: res.livekit_url || 'wss://your-project.livekit.cloud',
        title,
      });
    } catch (err: any) {
      alert('Không thể tham gia phòng: ' + (err.message || err));
    }
  };

  // Start Video Call directly from Chat
  const handleStartCallFromChat = async () => {
    if (!selectedConversation) return;
    try {
      const call = await videoApi.createCall(`Phỏng vấn: ${selectedConversation.title}`);
      await handleJoinCall(call.id, call.room_name, call.title);
    } catch (err: any) {
      alert('Không thể tạo phòng gọi: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return authView === 'login' ? (
      <LoginPage onSwitchToRegister={() => setAuthView('register')} />
    ) : (
      <RegisterPage onSwitchToLogin={() => setAuthView('login')} />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onSelectNotification={(notif) => {
          if (notif.type === 'video_call' && notif.metadata?.call_id) {
            handleJoinCall(notif.metadata.call_id, notif.metadata.room_name || 'Phòng phỏng vấn', 'Cuộc gọi từ thông báo');
          }
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {currentTab === 'chat' ? (
          <div className="flex-1 flex overflow-hidden">
            <ChatList
              selectedConvId={selectedConversation?.id || null}
              onSelectConv={setSelectedConversation}
            />
            <ChatWindow
              conversation={selectedConversation}
              messages={messages}
              loadingMessages={loadingMessages}
              onSendMessage={handleSendMessage}
              onStartVideoCall={handleStartCallFromChat}
              isWsConnected={isWsConnected}
            />
          </div>
        ) : (
          <VideoCallDashboard onJoinCall={handleJoinCall} />
        )}
      </div>

      {/* Active Video Room Overlay */}
      {activeCall && (
        <VideoRoom
          callId={activeCall.callId}
          roomName={activeCall.roomName}
          token={activeCall.token}
          livekitUrl={activeCall.livekitUrl}
          callTitle={activeCall.title}
          onLeave={() => setActiveCall(null)}
        />
      )}
    </div>
  );
};
