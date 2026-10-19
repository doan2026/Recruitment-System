import { redirect } from "next/navigation";

// Resolve aliases on the server instead of hydrating a prerendered redirect
// beneath the account-dependent candidate layout.
export const dynamic = "force-dynamic";

export default function RecommendationsPage() {
  redirect("/candidate/jobs#suitable-jobs");
}
