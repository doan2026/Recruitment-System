"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useCurrentAccount } from "@/components/SessionGate";
import { useNotifications } from "@/components/NotificationProvider";
import { PageHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import { notificationDestination } from "@/lib/notificationState";

function NotificationsList({ role }: { role: string }) {
  const { notifications, loading, error, marking, refresh, hasMore, loadMore, markAsRead, markAllAsRead, unreadCount } = useNotifications();
  useEffect(() => { void refresh(); }, [refresh]);
  return <main>
    <PageHeader eyebrow="CẬP NHẬT" title="Thông báo" description={`Theo dõi hồ sơ, lịch phỏng vấn và tin nhắn. ${unreadCount} thông báo chưa đọc.`}
      action={<div className="btn-group"><button className="btn" onClick={() => void refresh()} disabled={loading}>Tải lại thông báo</button><button className="btn btn-secondary" onClick={() => void markAllAsRead()} disabled={!unreadCount || loading || marking}>{marking ? "Đang cập nhật…" : "Đánh dấu tất cả là đã đọc"}</button></div>} />
    <section className="panel stack" aria-label="Danh sách thông báo">
      {error && <ErrorState message={error} onRetry={() => void refresh()} />}
      {loading && <LoadingState />}
      {!notifications.length && !loading && !error && <EmptyState title="Chưa có thông báo" description="Các cập nhật mới sẽ hiển thị tại đây." />}
      {notifications.map(notification => {
        const destination = notificationDestination(notification, role);
        return <article key={notification.id} style={{ padding: "16px 0", borderBottom: "1px solid var(--line)", overflowWrap: "anywhere" }}>
          <div className="section-head"><h2>{notification.title}</h2><StatusBadge tone={notification.is_read ? "neutral" : "success"}>{notification.is_read ? "Đã đọc" : "Chưa đọc"}</StatusBadge></div>
          <p>{notification.body}</p>
          <p className="muted"><time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></p>
          <div className="btn-group">
            {destination && <Link className="btn" href={destination} onClick={() => { if (!notification.is_read) void markAsRead(notification.id); }}>Xem chi tiết</Link>}
            {!notification.is_read && <button className="btn" disabled={marking} onClick={() => void markAsRead(notification.id)}>Đánh dấu đã đọc</button>}
          </div>
        </article>;
      })}
      {hasMore && <button className="btn" disabled={loading} onClick={() => void loadMore()}>Tải thêm thông báo</button>}
    </section>
  </main>;
}

export default function NotificationsScreen() {
  const account = useCurrentAccount();
  return account ? <NotificationsList role={account.role} /> : <LoadingState />;
}
