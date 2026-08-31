import { CompanyInvitationAcceptance } from "../../../../components/CompanyInvitationAcceptance";
import { PageHeader } from "../../../../components/ui";

export default function InvitationAcceptPage() {
  return (
    <main>
      <PageHeader
        eyebrow="RECRUITER · COMPANY"
        title="Nhận lời mời tham gia công ty"
        description="Xác nhận đúng tài khoản và token do OWNER gửi để tham gia với vai trò MEMBER."
      />
      <CompanyInvitationAcceptance />
    </main>
  );
}
