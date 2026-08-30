"use client";

import { Fragment, type ReactNode, useSyncExternalStore } from "react";
import {
  getApiSessionRevision,
  subscribeToApiSession,
} from "../lib/apiClient";

export function ApiSessionBoundary({ children }: { children: ReactNode }) {
  const revision = useSyncExternalStore(
    subscribeToApiSession,
    getApiSessionRevision,
    getApiSessionRevision,
  );

  return (
    <Fragment key={revision}>
      {children}
    </Fragment>
  );
}
