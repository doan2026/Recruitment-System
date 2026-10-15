"use client";

import { Fragment, type ReactNode, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  getApiSessionRevision,
  subscribeToApiSession,
} from "../lib/apiClient";

export function ApiSessionBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const revision = useSyncExternalStore(
    subscribeToApiSession,
    getApiSessionRevision,
    getApiSessionRevision,
  );

  // Private screens reset on an identity change. Public auth forms must keep
  // their state long enough to finish OTP onboarding or show a role mismatch.
  const authFlow = ["/login", "/register", "/recruiter/login", "/recruiter/register", "/admin/login", "/auth/callback", "/forgot-password", "/reset-password"].includes(pathname);
  return (
    <Fragment key={authFlow ? "authentication-flow" : revision}>
      {children}
    </Fragment>
  );
}
