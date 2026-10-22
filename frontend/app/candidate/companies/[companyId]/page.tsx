import { CompanyProfile } from "@/components/CompanyProfile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hồ sơ công ty và việc đang tuyển | CareerHub" };

export default function CandidateCompanyPage({ params }: { params: { companyId: string } }) {
  return <CompanyProfile companyId={params.companyId} basePath="/candidate/companies" />;
}
