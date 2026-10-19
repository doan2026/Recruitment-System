"use client";

import type { ReactNode } from "react";
import { CandidateWorkspace } from "./CandidateWorkspace";

// Shared routes (messages and notifications) use the same candidate navigation.
// CandidateWorkspace also guards against nested shells inside /candidate.
export function CandidateShell({ children }: { children: ReactNode }) {
  return <CandidateWorkspace>{children}</CandidateWorkspace>;
}
