import { CompaniesDirectory } from "@/components/CompaniesDirectory";

export const metadata = { title: "Khám phá công ty | CareerHub" };

export default function CandidateCompaniesPage() {
  return <CompaniesDirectory basePath="/candidate/companies" />;
}
