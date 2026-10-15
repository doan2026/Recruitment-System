import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { ApiClientError, toUserMessage } from "../../../lib/apiClient";
import { companyLogoFallback, orderPublicCompanyMedia } from "../../../lib/companyPublicProfile";
import { getPublicCompany } from "../../../lib/person2Api";

function CompanyNotFound() {
  return (
    <main>
      <EmptyState title="Không tìm thấy doanh nghiệp" description="Hồ sơ có thể chưa được xác minh hoặc không còn công khai." />
      <Link className="btn" href="/companies">Quay về danh sách</Link>
    </main>
  );
}

function safeWebsite(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function CompanyDetailPage({ params }: { params: { companyId: string } }) {
  let response;
  try {
    response = await getPublicCompany(params.companyId);
  } catch (reason: unknown) {
    if (reason instanceof ApiClientError && reason.code === "COMPANY_NOT_FOUND") return <CompanyNotFound />;
    return (
      <main>
        <div className="notice notice-danger" role="alert">
          <strong>Chưa tải được hồ sơ doanh nghiệp</strong>
          <p>{toUserMessage(reason)}</p>
        </div>
        <Link className="btn" href="/companies">Quay về danh sách</Link>
      </main>
    );
  }

  const company = response.data;
  if (!company) {
    return <CompanyNotFound />;
  }

  const website = safeWebsite(company.website);
  const media = orderPublicCompanyMedia(company.media);

  return (
    <main>
      <PageHeader eyebrow="CANDIDATE · COMPANY" title={company.name} description={company.description} />
      <Link className="btn" href={`/reports?type=COMPANY&id=${encodeURIComponent(company.id)}`}>Báo cáo công ty</Link>

      <section className="panel company-public-hero">
        <div className="company-public-logo">
          {company.logoUrl ? <img src={company.logoUrl} alt={`Logo ${company.name}`} /> : <span aria-hidden="true">{companyLogoFallback(company.name)}</span>}
        </div>
        <div>
          <p className="eyebrow">DOANH NGHIỆP ĐÃ XÁC MINH</p>
          <h2>{company.industry}</h2>
          <p>{company.address}</p>
          <div className="btn-group">
            {website ? <a className="btn btn-primary" href={website} target="_blank" rel="noreferrer">Mở website</a> : null}
            <Link className="btn" href="/companies">Quay về danh sách</Link>
          </div>
        </div>
      </section>

      <section className="grid-3 company-public-facts" aria-label="Thông tin doanh nghiệp">
        <div className="stat"><strong>Quy mô</strong><p>{company.size}</p></div>
        <div className="stat"><strong>Mã số thuế</strong><p>{company.taxCode}</p></div>
        <div className="stat"><strong>Cập nhật</strong><p>{new Date(company.updatedAt).toLocaleDateString("vi-VN")}</p></div>
      </section>

      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">KHÔNG GIAN LÀM VIỆC</p><h2>Hình ảnh doanh nghiệp</h2></div><span className="badge">{media.length} media</span></div>
        {media.length === 0 ? (
          <EmptyState title="Chưa có hình ảnh công khai" description="Media chỉ xuất hiện sau khi hoàn tất xử lý và được hồ sơ công khai trả về." />
        ) : (
          <div className="company-public-media">
            {media.map((item, index) => item.type === "VIDEO" ? (
              <video key={`${item.url}-${index}`} controls preload="metadata" aria-label={`Video giới thiệu ${company.name}`}><source src={item.url} /></video>
            ) : (
              <img key={`${item.url}-${index}`} src={item.url} alt={`Không gian làm việc tại ${company.name} ${index + 1}`} loading="lazy" />
            ))}
          </div>
        )}
        <p className="filter-note">Danh sách này lấy từ response công khai hiện tại; media vừa xác nhận có thể cần thời gian xử lý trước khi xuất hiện.</p>
      </section>
    </main>
  );
}
