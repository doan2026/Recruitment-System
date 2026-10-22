"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { useCurrentAccount } from "@/components/SessionGate";
import { portalHome } from "@/lib/portalRoutes";

export default function NotFound() {
  const account = useCurrentAccount();
  return <main className="route-error card"><span className="tool-icon"><SearchX size={24} /></span><p className="eyebrow">KHÔNG TÌM THẤY TRANG</p><h1>Có vẻ bạn đã rẽ nhầm hướng.</h1><p>Đường dẫn này không còn tồn tại. Hãy trở về trang chủ để tiếp tục hành trình của bạn.</p><Link className="btn btn-primary" href={account ? portalHome(account.role) : "/"}>Về trang chủ</Link></main>;
}
