"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useCurrentAccount } from "../../../components/SessionGate";
import { ConfirmationDialog } from "../../../components/ConfirmationDialog";
import { ApiClientError, requestApi } from "../../../lib/apiClient";
import {
  person1Error,
  person1FormError,
  profileDateError,
  profileSectionLabels,
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
  disabled?: boolean;
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
              className="textarea resize-none"
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
              disabled={f.disabled}
              min={f.name === "endDate" ? String(value.startDate ?? "") : undefined}
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
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formIssue = person1FormError(e.currentTarget);
    if (formIssue) { setError(formIssue); return; }
    if (busy) return;
    const dateIssue = profileDateError(block.key, draft);
    if (dateIssue) { setError(dateIssue); return; }
    setBusy(true);
    setError("");
    const body = Object.fromEntries(
      block.fields.map((f) => [
        f.name,
        f.type === "checkbox"
          ? Boolean(draft[f.name])
          : f.name === "endDate" && draft.isCurrent
            ? null
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
      if (editing === deleting) { setEditing(null); setDraft({}); }
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
                  .map((f) => (f.name === "isCurrent" ? item.isCurrent ? "Đang làm việc" : "" : item[f.name] ? String(item[f.name]) : ""))
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
      <form noValidate onSubmit={save}>
        <fieldset disabled={busy} className="form-stack person1-fieldset">
          <h3>{editing ? "Chỉnh sửa" : "Thêm thông tin"}</h3>
          <Fields
            fields={block.fields.map((field) => field.name === "endDate" && block.key === "experiences" ? { ...field, disabled: Boolean(draft.isCurrent) } : field)}
            value={draft}
            set={(name, value) => {
              setError("");
              setDraft((d) => ({ ...d, [name]: value, ...(name === "isCurrent" && value ? { endDate: null } : {}) }));
            }}
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
  const [editingGeneral, setEditingGeneral] = useState(false);
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
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formIssue = person1FormError(e.currentTarget);
    if (formIssue) { setError(formIssue); return; }
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
      setDraft({ ...result.data });
      setEditingGeneral(false);
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
    <main className="form-stack candidate-profile-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">HỒ SƠ ỨNG VIÊN</p>
          <h1>Hồ sơ cá nhân</h1>
          <p className="muted">Quản lý thông tin cá nhân, kỹ năng, kinh nghiệm và hồ sơ nghề nghiệp của bạn.</p>
        </div>
        <Link className="btn btn-primary" href="/candidate/profile/cvs">Quản lý CV</Link>
      </div>
      {loading ? <p role="status">Đang tải hồ sơ…</p> : !profile && error ? null : <>
        <section className="candidate-profile-hero card">
          <div className="candidate-profile-banner" aria-hidden="true" />
          <div className="candidate-profile-hero-body">
            <div className="candidate-profile-avatar-wrap">
              <img className="candidate-profile-avatar" src={profile?.avatarUrl || "/figma/profile/2013b.png"} alt="Ảnh đại diện" />
              <label className="candidate-avatar-upload" title="Thay ảnh đại diện">
                <span aria-hidden="true">▣</span><span className="sr-only">Thay ảnh đại diện</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { void avatar(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              </label>
            </div>
            <div className="candidate-profile-identity">
              <h2>{profile?.fullName || "Tên của bạn"}</h2>
              <p className="candidate-profile-headline">{profile?.headline || "Thêm vị trí mong muốn"}</p>
              <div className="candidate-profile-contact">
                {profile?.address ? <span>⌖ {profile.address}</span> : null}
                {account?.email ? <span>✉ {account.email}</span> : null}
                {profile?.phone ? <span>☎ {profile.phone}</span> : null}
              </div>
            </div>
            <div className="candidate-completion">
              <div><strong>Hồ sơ đã hoàn thiện {profile?.completionPercent ?? 0}%</strong><span>{profile?.completionPercent ?? 0}%</span></div>
              <progress max={100} value={profile?.completionPercent ?? 0} aria-label="Mức độ hoàn thiện hồ sơ" />
              <p>{profile?.missingSections?.length ? `Còn thiếu: ${profile.missingSections.map((section) => profileSectionLabels[section] ?? "Thông tin bổ sung").join(", ")}` : profile ? "Hồ sơ đã sẵn sàng để nhà tuyển dụng xem." : "Bắt đầu bằng cách bổ sung thông tin cá nhân."}</p>
            </div>
          </div>
        </section>
        <div className="candidate-profile-grid">
          <div className="candidate-profile-main-column">
            <section className="card candidate-profile-intro"><h2>Giới thiệu bản thân</h2><p>{profile?.summary || "Thêm phần giới thiệu ngắn để nhà tuyển dụng hiểu rõ hơn về kinh nghiệm và mục tiêu nghề nghiệp của bạn."}</p></section>
            <section className="card form-stack candidate-general-profile" id="profile-editor">
              <div className="candidate-profile-section-heading"><h2>Thông tin cá nhân</h2><button type="button" className="btn" onClick={() => setEditingGeneral((value) => !value)}>{editingGeneral ? "Đóng chỉnh sửa" : "✎ Chỉnh sửa hồ sơ"}</button></div>
              {editingGeneral ? <form className="form-stack" noValidate onSubmit={save}>
                <fieldset className="person1-fieldset person1-grid" disabled={busy}><Fields fields={general} value={draft} set={(name, value) => setDraft((d) => ({ ...d, [name]: value }))} /></fieldset>
                <div className="row-wrap"><button className="btn btn-primary">{busy ? "Đang lưu…" : "Lưu thông tin chung"}</button><button className="btn" type="button" onClick={() => { setEditingGeneral(false); setDraft(profile ? { ...profile } : {}); }}>Hủy</button></div>
              </form> : <div className="candidate-profile-facts">
                <div><span>Họ và tên</span><strong>{profile?.fullName || "Chưa cập nhật"}</strong></div><div><span>Chức danh</span><strong>{profile?.headline || "Chưa cập nhật"}</strong></div><div><span>Số điện thoại</span><strong>{profile?.phone || "Chưa cập nhật"}</strong></div><div><span>Địa điểm</span><strong>{profile?.address || "Chưa cập nhật"}</strong></div>
              </div>}
            </section>
            {blocks.filter((block) => block.key === "experiences" || block.key === "projects").map((block) => <BlockEditor key={block.key} block={block} items={profile?.[block.key] ?? []} onSaved={setProfile} />)}
          </div>
          <aside className="candidate-profile-aside">
            {blocks.filter((block) => block.key === "skills" || block.key === "educations" || block.key === "certificates").map((block) => <BlockEditor key={block.key} block={block} items={profile?.[block.key] ?? []} onSaved={setProfile} />)}
            <section className="card candidate-profile-cv"><h2>CV đã tải lên</h2><p>Quản lý CV, tạo CV trực tuyến hoặc đặt CV mặc định khi ứng tuyển.</p><Link className="btn" href="/candidate/profile/cvs">Mở thư viện CV →</Link></section>
          </aside>
        </div>
      </>}
      {error ? <div className="notice notice-danger" role="alert">{error}<button className="btn" onClick={() => setReload((n) => n + 1)}>Tải lại hồ sơ</button></div> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
    </main>
  );
}
