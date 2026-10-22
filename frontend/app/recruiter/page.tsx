import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, UsersRound, CalendarCheck, Building2, Check, Files, Plus } from "lucide-react";
import { PublicShell } from "@/components/PublicShell";
import { PortalEntry } from "@/components/PortalEntry";

const solutions = [
  { icon: BriefcaseBusiness, title: "Đăng tin đúng trọng tâm", body: "Giới thiệu vị trí, yêu cầu và đãi ngộ rõ ràng. Quản lý vòng đời tin tuyển dụng trong một nơi." },
  { icon: UsersRound, title: "Tìm thấy sự phù hợp", body: "Tiếp nhận CV, xem hồ sơ và theo dõi từng ứng viên qua các bước tuyển dụng." },
  { icon: CalendarCheck, title: "Kết nối liền mạch", body: "Trao đổi, sắp xếp phỏng vấn và gửi đề nghị tuyển dụng ngay trong quy trình của bạn." },
];

export default function RecruiterHomePage() {
  return <PortalEntry role="RECRUITER"><PublicShell portal="RECRUITER"><main className="recruiter-home">
    <section className="discovery-hero recruiter-hero"><div className="discovery-copy"><span className="hero-pill"><span />CAREERHUB FOR BUSINESS</span><h1>Đội ngũ phù hợp.<br /><em>Tạo nên khác biệt.</em></h1><p>Từ tin tuyển dụng đến ứng viên tiếp theo. Tập trung vào con người, để CareerHub kết nối từng bước còn lại.</p><div className="hero-actions"><Link className="btn btn-primary" href="/recruiter/register">Bắt đầu tuyển dụng <ArrowRight size={18} /></Link><Link className="btn" href="/recruiter/login">Đã có tài khoản? Đăng nhập</Link></div><div className="hero-benefits"><span><Check size={15} /> Quản lý tập trung</span><span><Check size={15} /> Quy trình rõ ràng</span><span><Check size={15} /> Kết nối trực tiếp</span></div></div>
      <aside className="hiring-preview" aria-label="Quy trình tuyển dụng"><div className="hiring-preview-head"><span className="preview-symbol"><Building2 size={24} /></span><div><small>KHÔNG GIAN TUYỂN DỤNG</small><strong>Tuyển đúng người. Cùng tiến xa.</strong></div></div><div className="hiring-preview-position"><BriefcaseBusiness size={21} /><span>Vị trí đang tuyển<small>Mỗi cơ hội, một hành trình mới</small></span><Plus size={20} /></div><div className="hiring-stages">{[{label:"Tiếp nhận",icon:Files},{label:"Sàng lọc",icon:UsersRound},{label:"Phỏng vấn",icon:CalendarCheck}].map(({label,icon:Icon},index) => <div key={label}><span className="hiring-stage-number">0{index+1}</span><Icon size={21} /><strong>{label}</strong></div>)}</div><p className="preview-note"><Check size={16} /> Một quy trình. Trọn hành trình.</p></aside>
    </section>
    <section id="solutions" className="home-section"><div className="section-heading"><div><p className="eyebrow">DÀNH CHO ĐỘI NGŨ TUYỂN DỤNG</p><h2>Một không gian, mọi bước tuyển dụng.</h2></div></div><div className="career-tools">{solutions.map(({icon:Icon,title,body}) => <article className="tool-card" key={title}><span className="tool-icon"><Icon size={25} /></span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <section id="how-it-works" className="home-section recruiter-process"><div><p className="eyebrow">BẮT ĐẦU THẬT ĐƠN GIẢN</p><h2>Từ cơ hội đến<br />thành viên mới.</h2><p>Không bỏ sót hồ sơ, không đứt đoạn trao đổi. Mọi bước đều có nơi để theo dõi.</p><Link href="/recruiter/register" className="text-link">Tạo tài khoản nhà tuyển dụng <ArrowRight size={17} /></Link></div><ol>{[{title:"Giới thiệu doanh nghiệp",body:"Hoàn thiện và xác minh hồ sơ công ty để xây dựng niềm tin."},{title:"Đăng vị trí bạn đang tìm",body:"Mô tả cơ hội rõ ràng để tiếp cận ứng viên phù hợp."},{title:"Kết nối và xây dựng đội ngũ",body:"Tiếp nhận hồ sơ, phỏng vấn và theo dõi kết quả tuyển dụng."}].map(({title,body},i)=><li key={title}><span>0{i+1}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol></section>
    <section className="home-signup"><div><p className="eyebrow">ĐỘI NGŨ TỐT BẮT ĐẦU TỪ MỘT KẾT NỐI</p><h2>Sẵn sàng cho lần tuyển dụng tiếp theo?</h2><p>Tạo không gian tuyển dụng riêng cho doanh nghiệp của bạn.</p></div><Link className="btn btn-primary" href="/recruiter/register">Bắt đầu ngay <ArrowRight size={18} /></Link></section>
  </main></PublicShell></PortalEntry>;
}
