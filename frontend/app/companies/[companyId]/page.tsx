import { CompanyProfile } from "@/components/CompanyProfile";

export const dynamic = "force-dynamic";

export default function CompanyDetailPage({ params }: { params: { companyId: string } }) {
  return <CompanyProfile companyId={params.companyId} />;
}
