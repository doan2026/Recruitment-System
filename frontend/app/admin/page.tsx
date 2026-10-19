import { AdminWorkspace } from "../../components/AdminWorkspace";

export default function AdminPage({ searchParams }: { searchParams: { tab?: string | string[] } }) {
  return <AdminWorkspace initialTab={searchParams.tab === "audit" ? "audit" : "stats"} />;
}
