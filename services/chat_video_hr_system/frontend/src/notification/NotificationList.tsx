import React from 'react';
import { AppNotification } from '../api/notification';
import { MessageSquare, Video, Bell, Check } from 'lucide-react';

interface NotificationListProps {
  notifications: AppNotification[];
  onMarkRead: (id: string) => void;
  onSelectNotification?: (notif: AppNotification) => void;
}

export const NotificationList: React.FC<NotificationListProps> = ({
  notifications,
  onMarkRead,
  onSelectNotification,
}) => {
  if (notifications.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        Không có thông báo mới nào
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto divide-y divide-slate-800">
      {notifications.map((n) => {
        const timeStr = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return (
          <div
            key={n.id}
            onClick={() => {
              if (!n.is_read) onMarkRead(n.id);
              onSelectNotification?.(n);
            }}
            className={`p-4 transition cursor-pointer hover:bg-slate-800/50 flex items-start gap-3 ${
              !n.is_read ? 'bg-indigo-950/20' : ''
            }`}
          >
            <div className={`p-2 rounded-xl shrink-0 ${
              n.type === 'video_call'
                ? 'bg-purple-600/20 text-purple-400'
                : 'bg-indigo-600/20 text-indigo-400'
            }`}>
              {n.type === 'video_call' ? <Video className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-xs text-white truncate">{n.title}</span>
                <span className="text-[10px] text-slate-500">{timeStr}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">{n.body}</p>
            </div>

            {!n.is_read && (
              <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 self-center" />
            )}
          </div>
        );
      })}
    </div>
  );
};
