import { CompanyInvitationAcceptance } from "@/components/CompanyInvitationAcceptance";
import { PageHeader } from "@/components/ui";

export default function InvitationAcceptPage() {
  return (
    <main>
      <PageHeader
        eyebrow="THÀNH VIÊN DOANH NGHIỆP"
        title="Nhận lời mời tham gia công ty"
        description="Dùng mã lời mời từ chủ sở hữu để tham gia đội ngũ tuyển dụng của công ty."
      />
      <CompanyInvitationAcceptance />
    </main>
  );
}
