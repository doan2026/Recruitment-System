import { PageHeader, EmptyState } from "@/components/ui";

export default function AdminDashboardPage() {
  return (
    <div>
      <PageHeader
        eyebrow="TỔNG QUAN"
        title="Admin Dashboard"
        description="Quản trị hệ thống CareerHub."
      />
      <EmptyState
        title="Dữ liệu đang được cập nhật"
        description="Các tính năng quản trị sẽ sớm được ra mắt trong phiên bản tiếp theo."
      />
    </div>
  );
}
