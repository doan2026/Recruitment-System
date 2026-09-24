"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { exchangeGoogle, landing, person1Error } from "../../../lib/person1Api";
export default function GoogleCallback() {
  const router = useRouter();
  const code = useRef("");
  const read = useRef(false);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<"CANDIDATE" | "RECRUITER">("CANDIDATE");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    code.current =
      new URLSearchParams(location.hash.slice(1)).get("code") ?? "";
    history.replaceState(null, "", location.pathname);
    setReady(!!code.current);
    if (!code.current)
      setError("Đăng nhập Google chưa hoàn tất. Hãy bắt đầu lại.");
  }, []);
  async function exchange() {
    if (pending || !code.current) return;
    setPending(true);
    setError("");
    try {
      const account = await exchangeGoogle(code.current, role);
      code.current = "";
      router.replace(landing(account.role));
    } catch (e) {
      code.current = "";
      setReady(false);
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="card form-stack">
      <h1>Hoàn tất đăng nhập Google</h1>
      <p>
        Chọn vai trò nếu bạn tạo tài khoản lần đầu. Tài khoản đã có giữ nguyên
        vai trò.
      </p>
      <label className="field">
        Vai trò
        <select
          className="select"
          value={role}
          disabled={pending}
          onChange={(e) => setRole(e.target.value as typeof role)}
        >
          <option value="CANDIDATE">Ứng viên</option>
          <option value="RECRUITER">Nhà tuyển dụng</option>
        </select>
      </label>
      <button
        className="btn btn-primary"
        disabled={!ready || pending}
        onClick={() => void exchange()}
      >
        {pending ? "Đang xác minh…" : "Tiếp tục"}
      </button>
      {error ? (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Link href="/login">Quay lại đăng nhập</Link>
    </section>
  );
}
