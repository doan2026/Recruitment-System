"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "../../../lib/authSession";
import { exchangeGoogle, landing, loginRoute, person1Error } from "../../../lib/person1Api";
export default function GoogleCallback() {
  const router = useRouter();
  const started = useRef(false);
  const [role, setRole] = useState<"CANDIDATE" | "RECRUITER">("CANDIDATE");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    // StrictMode runs effects twice; consume the one-time exchange only once.
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(location.hash.slice(1));
    const code = fragment.get("code");
    const portal = fragment.get("role");
    history.replaceState(null, "", location.pathname);
    if (!code || (portal !== "CANDIDATE" && portal !== "RECRUITER")) {
      setPending(false);
      setError("Đăng nhập Google chưa hoàn tất. Hãy bắt đầu lại từ trang đăng nhập.");
      return;
    }
    setRole(portal);
    void (async () => {
      try {
        const account = await exchangeGoogle(code, portal);
        if (account.role !== portal) {
          await signOut().catch(() => undefined);
          setError("Tài khoản này thuộc vai trò khác. Hãy dùng đúng trang đăng nhập.");
          return;
        }
        router.replace(landing(account.role));
      } catch (reason) {
        setError(person1Error(reason));
      } finally {
        setPending(false);
      }
    })();
  }, [router]);
  return (
    <section className="card form-stack">
      <h1>Đăng nhập Google</h1>
      {pending ? <p role="status">Đang hoàn tất đăng nhập…</p> : null}
      {error ? (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      ) : null}
      {error ? <Link href={loginRoute(role)}>Quay lại đăng nhập</Link> : null}
    </section>
  );
}
