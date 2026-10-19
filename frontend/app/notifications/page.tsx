"use client";

import Link from "next/link";
import { SessionGate, useCurrentAccount } from "@/components/SessionGate";
import { CandidateShell } from "@/components/CandidateShell";
import { RecruiterShell } from "@/components/RecruiterShell";
import { AdminShell } from "@/components/AdminShell";
import { PublicShell } from "@/components/PublicShell";
import { useNotifications } from "@/components/NotificationProvider";
import { PageHeader, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { notificationDestination } from "@/lib/notificationState";

function NotificationsList({ role }: { role: string }) {
  const { notifications, loading, error, marking, refresh, hasMore, loadMore, markAsRead, markAllAsRead, unreadCount } = useNotifications();
  return <main>
    <PageHeader title="Thông báo" description={`Theo dõi hồ sơ, lịch phỏng vấn và tin nhắn. ${unreadCount} thông báo chưa đọc.`} />
    <div className="btn-group" style={{ marginBottom: 20 }}>
      <button className="btn" onClick={() => void refresh()} disabled={loading}>Tải lại thông báo</button>
      <button className="btn" onClick={() => void markAllAsRead()} disabled={!unreadCount || loading || marking}>{marking ? "Đang cập nhật…" : "Đánh dấu tất cả là đã đọc"}</button>
    </div>
    <section className="card stack" aria-label="Danh sách thông báo">
      {error && <ErrorState message={error} onRetry={() => void refresh()} />}
      {loading && <LoadingState />}
      {!notifications.length && !loading && !error && <EmptyState title="Chưa có thông báo" description="Các cập nhật mới sẽ hiển thị tại đây." />}
      {notifications.map(notification => {
        const destination = notificationDestination(notification, role);
        return <article key={notification.id} style={{ padding: "16px 0", borderBottom: "1px solid var(--line)", overflowWrap: "anywhere" }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 8px" }}>{notification.title}</h2>
          <p>{notification.body}</p>
          <p className="muted"><time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time> · {notification.is_read ? "Đã đọc" : "Chưa đọc"}</p>
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

export default function NotificationsPage() {
  const account = useCurrentAccount();
  if (account?.role === "CANDIDATE") return <CandidateShell><NotificationsList role={account.role} /></CandidateShell>;
  if (account?.role === "RECRUITER") return <RecruiterShell><NotificationsList role={account.role} /></RecruiterShell>;
  if (account?.role === "ADMIN") return <AdminShell><NotificationsList role={account.role} /></AdminShell>;
  return <PublicShell><SessionGate role="CANDIDATE"><EmptyState title="Thông báo" description="Đăng nhập để xem thông báo của bạn." /></SessionGate></PublicShell>;
}
