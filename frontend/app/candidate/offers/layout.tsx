import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Phản hồi offer" };

export default function CandidateOffersLayout({ children }: { children: ReactNode }) {
  return children;
}
