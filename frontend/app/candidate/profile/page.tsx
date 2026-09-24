"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useCurrentAccount } from "../../../components/SessionGate";
import { ConfirmationDialog } from "../../../components/ConfirmationDialog";
import { ApiClientError, requestApi } from "../../../lib/apiClient";
import {
  person1Error,
  uploadPersonalFile,
  type CandidateProfile,
  type ProfileBlock,
} from "../../../lib/person1Api";
type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  max?: number;
};
const general: Field[] = [
  { name: "fullName", label: "Họ tên", max: 160 },
  { name: "headline", label: "Vị trí mong muốn", max: 200 },
  { name: "summary", label: "Giới thiệu", type: "textarea", max: 5000 },
  { name: "phone", label: "Điện thoại", max: 32 },
  { name: "address", label: "Địa chỉ", max: 500 },
  { name: "githubUrl", label: "GitHub", type: "url" },
  { name: "linkedinUrl", label: "LinkedIn", type: "url" },
  { name: "portfolioUrl", label: "Portfolio", type: "url" },
];
const blocks: {
  key: "educations" | "experiences" | "skills" | "certificates" | "projects";
  label: string;
  fields: Field[];
}[] = [
  {
    key: "educations",
    label: "Học vấn",
    fields: [
      { name: "school", label: "Trường", required: true, max: 200 },
      { name: "major", label: "Chuyên ngành", max: 160 },
      { name: "degree", label: "Bằng cấp", max: 120 },
      {
        name: "startDate",
        label: "Ngày bắt đầu",
        type: "date",
        required: true,
      },
      { name: "endDate", label: "Ngày kết thúc", type: "date" },
      { name: "description", label: "Mô tả", type: "textarea", max: 5000 },
    ],
  },
  {
    key: "experiences",
    label: "Kinh nghiệm",
    fields: [
      { name: "companyName", label: "Công ty", required: true, max: 160 },
      { name: "position", label: "Vị trí", required: true, max: 160 },
      {
        name: "startDate",
        label: "Ngày bắt đầu",
        type: "date",
        required: true,
      },
      { name: "endDate", label: "Ngày kết thúc", type: "date" },
      { name: "isCurrent", label: "Đang làm việc", type: "checkbox" },
      { name: "description", label: "Mô tả", type: "textarea", max: 5000 },
    ],
  },
  {
    key: "skills",
    label: "Kỹ năng",
    fields: [
      { name: "name", label: "Tên kỹ năng", required: true, max: 120 },
      { name: "level", label: "Mức độ", max: 40 },
    ],
  },
  {
    key: "certificates",
    label: "Chứng chỉ",
    fields: [
      { name: "name", label: "Tên chứng chỉ", required: true, max: 160 },
      { name: "issuer", label: "Đơn vị cấp", required: true, max: 160 },
      { name: "issuedAt", label: "Ngày cấp", type: "date", required: true },
      { name: "credentialUrl", label: "Liên kết chứng chỉ", type: "url" },
    ],
  },
  {
    key: "projects",
    label: "Dự án",
    fields: [
      { name: "name", label: "Tên dự án", required: true, max: 160 },
      { name: "role", label: "Vai trò", max: 160 },
      { name: "description", label: "Mô tả", type: "textarea", max: 5000 },
      { name: "url", label: "Liên kết", type: "url" },
    ],
  },
];
function Fields({
  fields,
  value,
  set,
}: {
  fields: Field[];
  value: Record<string, unknown>;
  set: (name: string, value: unknown) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label className="field" key={f.name}>
          {f.label}
          {f.required ? " *" : ""}
          {f.type === "textarea" ? (
            <textarea
              className="textarea"
              maxLength={f.max}
              required={f.required}
              value={String(value[f.name] ?? "")}
              onChange={(e) => set(f.name, e.target.value)}
            />
          ) : (
            <input
              className="input"
              type={f.type ?? "text"}
              required={f.required}
              maxLength={f.max ?? 2048}
              checked={
                f.type === "checkbox" ? Boolean(value[f.name]) : undefined
              }
              value={
                f.type === "checkbox" ? undefined : String(value[f.name] ?? "")
              }
              onChange={(e) =>
                set(
                  f.name,
                  f.type === "checkbox" ? e.target.checked : e.target.value,
                )
              }
            />
          )}
        </label>
      ))}
    </>
  );
}
function BlockEditor({
  block,
  items,
  onSaved,
}: {
  block: (typeof blocks)[number];
  items: ProfileBlock[];
  onSaved: (p: CandidateProfile) => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const body = Object.fromEntries(
      block.fields.map((f) => [
        f.name,
        f.type === "checkbox"
          ? Boolean(draft[f.name])
          : String(draft[f.name] ?? "").trim() || null,
      ]),
    );
    try {
      const result = await requestApi<CandidateProfile>(
        `/profile/${block.key}${editing ? "/" + editing : ""}`,
        { method: editing ? "PUT" : "POST", body, privateData: true },
      );
      onSaved(result.data);
      setDraft({});
      setEditing(null);
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestApi<CandidateProfile>(
        `/profile/${block.key}/${deleting}`,
        { method: "DELETE", privateData: true },
      );
      onSaved(result.data);
      setDeleting(null);
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card form-stack">
      <h2>{block.label}</h2>
      {items.length ? (
        <ul className="person1-items">
          {items.map((item) => (
            <li key={item.id}>
              <strong>
                {String(item.name ?? item.school ?? item.companyName)}
              </strong>
              <p>
                {block.fields
                  .filter(
                    (f) =>
                      ![
                        "name",
                        "school",
                        "companyName",
                        "description",
                      ].includes(f.name),
                  )
                  .map((f) => (item[f.name] ? String(item[f.name]) : ""))
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p>{item.description}</p>
              <div className="btn-group">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setEditing(item.id);
                    setDraft(item);
                  }}
                >
                  Sửa
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => setDeleting(item.id)}
                >
                  Xóa
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Chưa có thông tin.</p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={busy} className="form-stack person1-fieldset">
          <h3>{editing ? "Chỉnh sửa" : "Thêm thông tin"}</h3>
          <Fields
            fields={block.fields}
            value={draft}
            set={(name, value) => setDraft((d) => ({ ...d, [name]: value }))}
          />
          <div className="btn-group">
            <button className="btn btn-primary">
              {busy ? "Đang lưu…" : "Lưu " + block.label.toLowerCase()}
            </button>
            {editing ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEditing(null);
                  setDraft({});
                }}
              >
                Hủy sửa
              </button>
            ) : null}
          </div>
        </fieldset>
      </form>
      {error ? (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      ) : null}
      <ConfirmationDialog
        open={!!deleting}
        title={"Xóa " + block.label.toLowerCase()}
        description="Thông tin này sẽ được xóa khỏi hồ sơ."
        confirmLabel="Xóa"
        pending={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}
export default function ProfilePage() {
  const account = useCurrentAccount();
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    requestApi<CandidateProfile>("/profile/" + account.id, {
      privateData: true,
      signal: controller.signal,
    })
      .then((r) => {
        setProfile(r.data);
        setDraft({ ...r.data });
      })
      .catch((e) => {
        if (
          !controller.signal.aborted &&
          !(e instanceof ApiClientError && e.status === 404)
        )
          setError(person1Error(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [account, reload]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !account) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = Object.fromEntries(
        general.map((f) => [
          f.name,
          String(draft[f.name] ?? "").trim() || null,
        ]),
      );
      const result = await requestApi<CandidateProfile>(
        "/profile/" + account.id,
        { method: "PUT", privateData: true, body },
      );
      setProfile(result.data);
      setNotice("Đã lưu hồ sơ.");
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setBusy(false);
    }
  }
  async function avatar(file?: File) {
    if (!file || !account || busy) return;
    setBusy(true);
    setError("");
    try {
      const fileId = await uploadPersonalFile(file, "AVATAR");
      const result = await requestApi<CandidateProfile>(
        `/profile/${account.id}/avatar`,
        { method: "PUT", privateData: true, body: { fileId } },
      );
      setProfile(result.data);
      setNotice("Đã cập nhật ảnh đại diện.");
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="form-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">HỒ SƠ ỨNG VIÊN</p>
          <h1>Hồ sơ của tôi</h1>
        </div>
        <Link className="btn" href="/candidate/profile/cvs">
          Quản lý CV
        </Link>
      </div>
      {loading ? (
        <p role="status">Đang tải hồ sơ…</p>
      ) : (
        <>
          <section className="card">
            <h2>Mức độ hoàn thiện: {profile?.completionPercent ?? 0}%</h2>
            <progress
              max={100}
              value={profile?.completionPercent ?? 0}
              aria-label="Mức độ hoàn thiện hồ sơ"
            />
            {(profile?.completionPercent ?? 0) < 50 ? (
              <p className="notice notice-warning">
                Bổ sung hồ sơ để nhà tuyển dụng hiểu bạn hơn. Bạn vẫn có thể ứng
                tuyển.
              </p>
            ) : null}
          </section>
          <form className="card form-stack" onSubmit={save}>
            <h2>Thông tin chung</h2>
            <fieldset className="form-stack person1-fieldset" disabled={busy}>
              <Fields
                fields={general}
                value={draft}
                set={(name, value) =>
                  setDraft((d) => ({ ...d, [name]: value }))
                }
              />
              <button className="btn btn-primary">
                {busy ? "Đang lưu…" : "Lưu thông tin chung"}
              </button>
            </fieldset>
          </form>
          <section className="card form-stack">
            <h2>Ảnh đại diện</h2>
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt="Ảnh đại diện"
                width={100}
                height={100}
              />
            ) : null}
            <label className="field">
              Chọn ảnh, tối đa 2 MB
              <input
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => {
                  void avatar(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {profile?.avatarUrl ? (
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  if (!account) return;
                  setBusy(true);
                  try {
                    const r = await requestApi<CandidateProfile>(
                      `/profile/${account.id}/avatar`,
                      { method: "DELETE", privateData: true },
                    );
                    setProfile(r.data);
                  } catch (e) {
                    setError(person1Error(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Gỡ ảnh đại diện
              </button>
            ) : null}
          </section>
          {blocks.map((block) => (
            <BlockEditor
              key={block.key}
              block={block}
              items={profile?.[block.key] ?? []}
              onSaved={setProfile}
            />
          ))}
        </>
      )}
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
          <button className="btn" onClick={() => setReload((n) => n + 1)}>
            Tải lại hồ sơ
          </button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
    </main>
  );
}
