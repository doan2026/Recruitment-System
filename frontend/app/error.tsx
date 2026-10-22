"use client";

import { useCurrentAccount } from "@/components/SessionGate";
import { portalHome } from "@/lib/portalRoutes";
import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const account = useCurrentAccount();
  return <main className="route-error card"><span className="eyebrow">CAREERHUB</span><h1>Trang này cần được tải lại</h1><p>Một phần nội dung chưa sẵn sàng. Bạn có thể thử lại hoặc trở về không gian của mình.</p><div className="btn-group"><button className="btn btn-primary" onClick={reset}>Thử tải lại</button><Link className="btn" href={account ? portalHome(account.role) : "/"}>Về trang chủ</Link></div></main>;
}
