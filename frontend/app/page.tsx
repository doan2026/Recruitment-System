import Link from "next/link";
import { ArrowRight, Search, MapPin, FileText, BriefcaseBusiness, Building2, Compass, Check, Code2, ChartNoAxesCombined, Palette, Headphones } from "lucide-react";
import { PublicShell } from "@/components/PublicShell";
import { PortalEntry } from "@/components/PortalEntry";
import { FeaturedJobs } from "@/components/FeaturedJobs";

const categories = [
  { label: "Công nghệ thông tin", q: "Developer", icon: Code2 },
  { label: "Kinh doanh & Marketing", q: "Marketing", icon: ChartNoAxesCombined },
  { label: "Thiết kế & Sáng tạo", q: "Designer", icon: Palette },
  { label: "Chăm sóc khách hàng", q: "Chăm sóc khách hàng", icon: Headphones },
];
const tools = [
  { title: "CV kể đúng câu chuyện của bạn", description: "Tạo và quản lý CV, thể hiện kinh nghiệm và thế mạnh theo cách riêng.", href: "/candidate/profile/cvs", label: "Khám phá công cụ CV", icon: FileText },
  { title: "Hiểu rõ nơi bạn sẽ gắn bó", description: "Tìm hiểu văn hóa, thông tin và cơ hội đang mở tại các doanh nghiệp.", href: "/candidate/companies", label: "Khám phá công ty", icon: Building2 },
  { title: "Chủ động với hành trình ứng tuyển", description: "Hồ sơ, lịch phỏng vấn và trao đổi với nhà tuyển dụng luôn ở một nơi.", href: "/candidate/dashboard", label: "Mở không gian của bạn", icon: Compass },
];

export default function HomePage() {
  return <PortalEntry role="CANDIDATE"><PublicShell><main className="candidate-home">
    <section className="discovery-hero" aria-labelledby="discovery-title">
      <div className="discovery-copy"><span className="hero-pill"><span />Mỗi bước đi, gần hơn với cơ hội phù hợp</span>
        <h1 id="discovery-title">Công việc phù hợp.<br /><em>Tương lai bạn chọn.</em></h1>
        <p>Khám phá cơ hội mới, tạo hồ sơ ấn tượng và kết nối với nơi bạn thuộc về.</p>
        <form action="/candidate/jobs" className="hero-search" role="search" aria-label="Tìm kiếm việc làm">
          <label><Search size={20} aria-hidden="true" /><span className="sr-only">Vị trí hoặc kỹ năng</span><input name="q" placeholder="Vị trí, kỹ năng hoặc từ khóa…" maxLength={200} /></label>
          <label className="hero-location"><MapPin size={19} aria-hidden="true" /><span className="sr-only">Địa điểm làm việc</span><select name="location" defaultValue=""><option value="">Tất cả địa điểm</option><option>Hà Nội</option><option>Hồ Chí Minh</option><option>Đà Nẵng</option></select></label>
          <button className="btn btn-primary" type="submit">Tìm việc <ArrowRight size={17} aria-hidden="true" /></button>
        </form>
        <div className="popular-searches"><span>Thử tìm:</span>{["Developer", "Marketing", "Kế toán"].map(q => <Link prefetch={false} key={q} href={`/candidate/jobs?q=${encodeURIComponent(q)}`}>{q}</Link>)}</div>
      </div>
      <aside className="career-preview" aria-label="Hành trình nghề nghiệp">
        <div className="preview-orbit" aria-hidden="true" /><div className="preview-heading"><span className="preview-symbol"><BriefcaseBusiness size={26} /></span><span>HÀNH TRÌNH CỦA BẠN<strong>Bước tiếp theo, rõ ràng hơn.</strong></span></div>
        <div className="preview-step"><span className="step-icon"><FileText size={19} /></span><div><strong>Một hồ sơ thật ấn tượng</strong><small>Thể hiện đúng thế mạnh của bạn</small></div><Check size={17} className="step-check" /></div>
        <div className="preview-step"><span className="step-icon"><Search size={19} /></span><div><strong>Một cơ hội thật phù hợp</strong><small>Tìm việc theo điều bạn mong muốn</small></div><Check size={17} className="step-check" /></div>
        <div className="preview-step"><span className="step-icon"><Building2 size={19} /></span><div><strong>Một khởi đầu thật tự tin</strong><small>Kết nối với đội ngũ bạn muốn gắn bó</small></div><ArrowRight size={17} className="step-check" /></div>
        <p className="preview-note">Sẵn sàng cho chương tiếp theo của bạn.</p>
      </aside>
    </section>
    <section className="home-section" aria-labelledby="career-categories"><div className="section-heading"><div><span className="eyebrow">BẮT ĐẦU TỪ ĐIỀU BẠN GIỎI</span><h2 id="career-categories">Khám phá theo lĩnh vực</h2></div><Link className="text-link" href="/candidate/jobs">Tất cả việc làm <ArrowRight size={16} /></Link></div>
      <div className="category-grid">{categories.map(({label,q,icon:Icon}) => <Link prefetch={false} className="category-card" key={q} href={`/candidate/jobs?q=${encodeURIComponent(q)}`}><span><Icon size={23} /></span><strong>{label}</strong><ArrowRight size={17} /></Link>)}</div>
    </section>
    <FeaturedJobs />
    <section className="home-section" aria-labelledby="career-tools"><div className="section-heading"><div><span className="eyebrow">CHUẨN BỊ TỐT, TIẾN XA HƠN</span><h2 id="career-tools">Hơn cả một nơi tìm việc</h2></div></div><div className="career-tools">{tools.map(({title,description,href,label,icon:Icon}) => <article className="tool-card" key={href}><span className="tool-icon"><Icon size={24} /></span><h3>{title}</h3><p>{description}</p><Link className="text-link" prefetch={false} href={href}>{label}<ArrowRight size={16} /></Link></article>)}</div></section>
    <section className="home-signup"><div><span className="eyebrow">CƠ HỘI ĐẾN KHI BẠN SẴN SÀNG</span><h2>Bắt đầu từ hồ sơ của bạn.</h2><p>Tạo tài khoản để lưu việc yêu thích và theo dõi từng bước ứng tuyển.</p></div><Link className="btn btn-primary" href="/register">Tạo tài khoản miễn phí <ArrowRight size={18} /></Link></section>
  </main></PublicShell></PortalEntry>;
}
