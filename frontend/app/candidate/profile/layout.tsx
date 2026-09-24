import { type ReactNode } from "react";
import { Person1Gate } from "../../../components/Person1Gate";

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return <Person1Gate role="CANDIDATE">{children}</Person1Gate>;
}
