"use client";

import { useEffect, useState } from "react";
import { Building2, Users } from "lucide-react";
import type { ChatIdentityView } from "@/lib/chatIdentity";

export function ChatIdentityAvatar({ identity }: { identity: ChatIdentityView }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [identity.imageUrl]);
  const initials = identity.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("vi-VN");
  return <span className={`chat-identity-avatar chat-identity-${identity.kind.toLowerCase()}`} aria-hidden="true">
    {identity.imageUrl && !failed ? <img src={identity.imageUrl} width={42} height={42} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : identity.kind === "COMPANY" ? <Building2 size={21} /> : identity.kind === "GROUP" ? <Users size={21} /> : <span>{initials}</span>}
  </span>;
}
