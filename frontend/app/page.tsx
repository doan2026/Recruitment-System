import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Building2, FileText, Files, MessageSquare, Search } from "lucide-react";
import { PublicShell } from "@/components/PublicShell";

const destinations = [
  { title: "Tìm việc làm", description: "Khám phá cơ hội theo kỹ năng, vị trí và hình thức làm việc của bạn.", href: "/candidate/jobs", label: "Khám phá việc làm", icon: Search },
  { title: "Chuẩn bị hồ sơ", description: "Cập nhật thông tin cá nhân, quản lý CV và sẵn sàng ứng tuyển.", href: "/candidate/profile/cvs", label: "Quản lý CV", icon: FileText },
  { title: "Theo dõi ứng tuyển", description: "Xem tiến trình hồ sơ, lịch phỏng vấn và phản hồi từ nhà tuyển dụng.", href: "/candidate/applications", label: "Xem đơn ứng tuyển", icon: Files },
  { title: "Khám phá doanh nghiệp", description: "Tìm hiểu công ty và các vị trí đang mở trước khi gửi hồ sơ.", href: "/companies", label: "Xem doanh nghiệp", icon: Building2 },
  { title: "Quản lý tuyển dụng", description: "Đăng tin, xem hồ sơ ứng viên và theo dõi hoạt động tuyển dụng của công ty.", href: "/recruiter/dashboard", label: "Vào không gian tuyển dụng", icon: BriefcaseBusiness },
  { title: "Kết nối và trao đổi", description: "Tiếp tục trò chuyện với ứng viên hoặc nhà tuyển dụng trong một nơi.", href: "/messages", label: "Mở tin nhắn", icon: MessageSquare },
];
export default function HomePage() {
  return <PublicShell><main className="home-page">
    <section className="home-intro">
      <div><p className="eyebrow">CÙNG BẠN TRÊN HÀNH TRÌNH NGHỀ NGHIỆP</p><h1>Cơ hội mới.<br /><span>Một nơi để bắt đầu.</span></h1><p>Từ chuẩn bị CV đến kết nối với nhà tuyển dụng, CareerHub giúp bạn theo dõi từng bước và chủ động với cơ hội tiếp theo.</p><div className="btn-group"><Link className="btn btn-primary" href="/candidate/jobs">Tìm việc ngay <ArrowRight size={17} aria-hidden="true" /></Link><Link className="btn" href="/recruiter/login">Dành cho nhà tuyển dụng</Link></div></div>
      <aside className="home-journey" aria-label="Hành trình ứng tuyển"><p className="eyebrow">BƯỚC TIẾP THEO CỦA BẠN</p><h2>Tự tin từ bước đầu tiên</h2><ol><li><span>01</span><div><strong>Chuẩn bị hồ sơ</strong><p>Giới thiệu kinh nghiệm và thế mạnh của bạn.</p></div></li><li><span>02</span><div><strong>Tìm việc phù hợp</strong><p>Khám phá vị trí và doanh nghiệp bạn quan tâm.</p></div></li><li><span>03</span><div><strong>Kết nối và theo dõi</strong><p>Ứng tuyển, trao đổi và cập nhật tiến trình.</p></div></li></ol><Link className="text-link" href="/candidate/profile">Hoàn thiện hồ sơ <ArrowRight size={16} aria-hidden="true" /></Link></aside>
    </section>
    <section aria-labelledby="home-destinations"><div className="section-head"><div><p className="eyebrow">KHÔNG GIAN CAREERHUB</p><h2 id="home-destinations">Bạn muốn bắt đầu từ đâu?</h2><p className="muted">Các công cụ dành cho ứng viên và nhà tuyển dụng, cùng một trải nghiệm xuyên suốt.</p></div></div><div className="home-destinations">{destinations.map(({ title, description, href, label, icon: Icon }) => <article className="card home-destination" key={href}><span className="home-icon"><Icon size={22} strokeWidth={1.7} aria-hidden="true" /></span><h3>{title}</h3><p>{description}</p><Link className="text-link" href={href}>{label}<ArrowRight size={16} aria-hidden="true" /></Link></article>)}</div></section>
  </main></PublicShell>;
}
