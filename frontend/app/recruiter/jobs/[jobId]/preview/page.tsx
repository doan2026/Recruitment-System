"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";

export default function JobPreviewPage({
  params
}: {
  params: { jobId: string }
}) {
  return (
    <main>
      <PageHeader
        eyebrow="RECRUITER"
        title="Xem trước tin tuyển dụng"
        description="Kiểm tra nội dung hiển thị trước khi gửi duyệt."
        action={
          <div className="btn-group">
            <Link className="btn btn-secondary" href={`/recruiter/jobs/${params.jobId}/edit`}>Quay lại sửa</Link>
            <button className="btn btn-primary">Gửi duyệt</button>
          </div>
        }
      />
      
      <div className="card" style={{ padding: "40px 32px", maxWidth: 800, margin: "0 auto" }}>
        <h1>Vị trí: Senior Frontend Engineer</h1>
        <p className="muted">Công ty Cổ phần Mộc Công Nghệ • Hà Nội • Lên đến 40.000.000 VNĐ</p>
        
        <h3 style={{ marginTop: "32px" }}>Mô tả công việc</h3>
        <p>Phát triển các ứng dụng web với ReactJS, Next.js. Tối ưu hoá hiệu năng...</p>
        
        <h3 style={{ marginTop: "24px" }}>Yêu cầu ứng viên</h3>
        <ul>
          <li>Có 3+ năm kinh nghiệm React.</li>
          <li>Hiểu biết về SSR, SSG trong Next.js.</li>
        </ul>
        
        <div style={{ marginTop: "40px", padding: "16px", background: "var(--primary-soft)", borderRadius: "var(--radius-control)" }}>
          <p style={{ margin: 0, fontWeight: 500, color: "var(--primary-2)" }}>Góc nhìn của ứng viên: Nút ứng tuyển sẽ hiển thị ở đây.</p>
        </div>
      </div>
    </main>
  );
}
