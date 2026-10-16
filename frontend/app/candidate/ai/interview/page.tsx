import { EmptyState, PageHeader } from "@/components/ui";

export default function AIInterviewPracticePage() {
  return <main>
    <PageHeader eyebrow="AI ASSISTANT" title="Luyện tập phỏng vấn AI" />
    <EmptyState title="Luyện tập phỏng vấn chưa được mở"
      description="Hệ thống hiện chưa hỗ trợ luyện phỏng vấn bằng AI. Bạn có thể xem lịch phỏng vấn với nhà tuyển dụng."
      href="/candidate/interviews" action="Xem lịch phỏng vấn" />
  </main>;
}
