import type { ReactNode } from "react";
import { CandidateWorkspace } from "../../components/CandidateWorkspace";
import { SessionGate } from "../../components/SessionGate";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <CandidateWorkspace><SessionGate role="CANDIDATE" publicJobRoutes>{children}</SessionGate></CandidateWorkspace>;
}
