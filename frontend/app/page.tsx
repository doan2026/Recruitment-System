import Link from "next/link";
import { PageHeader } from "../components/ui";

const person2Cards = [
  {
    title: "Tìm việc theo AI & Search",
    desc: "Trang việc làm công khai, lọc theo nguồn, cursor/page mode và dữ liệu fallback từ AI/recommendation.",
    href: "/candidate/jobs",
    cta: "Mở việc làm",
  },
  {
    title: "Theo dõi hồ sơ ứng tuyển",
    desc: "Máy trạng thái hồ sơ APPLIED → REVIEWING → INTERVIEW → OFFER → HIRED/REJECTED.",
    href: "/candidate/applications",
    cta: "Mở hồ sơ của tôi",
  },
  {
    title: "Việc làm đã lưu",
    desc: "Giữ bookmark ổn định và hiển thị placeholder khi dữ liệu Job tạm gián đoạn.",
    href: "/candidate/bookmarks",
    cta: "Mở việc đã lưu",
  },
  {
    title: "Quản trị tin đăng",
    desc: "Recruiter tạo/sửa job, duyệt, đóng/mở tin, và quy tắc owner-only.",
    href: "/recruiter/jobs",
    cta: "Quản lý tin",
  },
  {
    title: "Dashboard tuyển dụng",
    desc: "Theo dõi số liệu Application đầy đủ ngay cả khi thống kê tin đang tuyển bị suy giảm.",
    href: "/recruiter/dashboard",
    cta: "Mở dashboard",
  },
  {
    title: "Quản lý công ty",
    desc: "Tạo công ty, upload media theo 3 bước, theo dõi verify status.",
    href: "/recruiter/company",
    cta: "Mở công ty",
  },
  {
    title: "Offer Center",
    desc: "Mẫu gửi offer theo phiên bản, gửi lại theo thời gian đáp ứng, và preview attachment.",
    href: "/recruiter/offer",
    cta: "Tạo offer",
  },
  {
    title: "AI Job Assistant",
    desc: "Chat UI với quản lý session_id, validate đầu vào, và chế độ rate limit.",
    href: "/ai",
    cta: "Mở AI",
  },
];

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">CAREER OPERATING SYSTEM</p>
          <h1>Nơi mỗi bước tuyển dụng đều <em>rõ ràng.</em></h1>
          <p>Tìm đúng công việc, theo dõi hồ sơ và vận hành pipeline tuyển dụng trên cùng một nhịp làm việc.</p>
          <div className="btn-group">
            <Link className="btn btn-primary btn-large" href="/candidate/jobs">Khám phá việc làm</Link>
            <Link className="btn btn-secondary btn-large" href="/recruiter/jobs">Không gian recruiter</Link>
          </div>
        </div>
        <div className="hero-orbit" aria-label="Tổng quan nền tảng">
          <span className="orbit-label">Career signal</span>
          <strong>92%</strong>
          <p>độ phù hợp cao nhất hôm nay</p>
          <div className="orbit-track"><span /></div>
          <small>AI · Skills · Preferences</small>
        </div>
      </section>

      <PageHeader
        eyebrow="PHẠM VI NGƯỜI 2"
        title="Các luồng nghiệp vụ đã sẵn sàng"
        description="Company, Job & Search, Application và AI được kết nối bằng một ngôn ngữ giao diện thống nhất."
      />
      <section className="feature-grid">
        {person2Cards.map((card, index) => (
          <article className="feature-card" key={card.href}>
            <span className="feature-number">{String(index + 1).padStart(2, "0")}</span>
            <h2>{card.title}</h2>
            <p>{card.desc}</p>
            <Link className="text-link" href={card.href}>{card.cta} <span aria-hidden="true">→</span></Link>
          </article>
        ))}
      </section>
    </main>
  );
}
