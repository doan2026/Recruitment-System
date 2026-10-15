import type { ReactNode } from "react";
import { Person1Gate } from "../../components/Person1Gate";
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Person1Gate role="ADMIN">{children}</Person1Gate>;
}
