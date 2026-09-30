import type { ReactNode } from "react";
import { CandidateWorkspace } from "../../components/CandidateWorkspace";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <CandidateWorkspace>{children}</CandidateWorkspace>;
}