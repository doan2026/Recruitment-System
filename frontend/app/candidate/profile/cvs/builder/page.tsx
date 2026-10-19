"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, requestApi } from "../../../../../lib/apiClient";
import { useCurrentAccount } from "../../../../../components/SessionGate";
import {
  contentFromProfile,
  renderCvPdf,
  validateBuilder,
} from "../../../../../lib/cvPdf";
import {
  person1Error,
  person1FormError,
  saveBlob,
  uploadPersonalFile,
  type BuilderContent,
  type CandidateCv,
  type CandidateProfile,
} from "../../../../../lib/person1Api";
const empty: BuilderContent = {
  fullName: "",
  headline: "",
  contact: "",
  summary: "",
  sections: [
    { title: "Kinh nghiệm", text: "" },
    { title: "Học vấn", text: "" },
    { title: "Kỹ năng", text: "" },
  ],
};
export default function BuilderPage() {
  const account = useCurrentAccount();
  const router = useRouter();
  const [content, setContent] = useState<BuilderContent>(empty);
  const [title, setTitle] = useState("CV của tôi");
  const [template, setTemplate] = useState<"classic" | "modern">("modern");
  const [original, setOriginal] = useState<CandidateCv | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const lastPreview = useRef("");
  const [loadFailed, setLoadFailed] = useState(false);
  const staged = useRef<{ fingerprint: string; fileId: string } | null>(null);
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    const id = new URLSearchParams(location.search).get("id");
    const load = id
      ? requestApi<CandidateCv>(
          `/profile/cvs/${encodeURIComponent(id)}/builder`,
          { privateData: true, signal: controller.signal },
        ).then((r) => {
          setOriginal(r.data);
          setTitle(r.data.title);
          setContent(validateBuilder(r.data.contentJson));
          setTemplate(r.data.templateId === "classic" ? "classic" : "modern");
        })
      : requestApi<CandidateProfile>("/profile/" + account.id, {
          privateData: true,
          signal: controller.signal,
        }).then((r) => setContent(contentFromProfile(r.data)));
    load
      .catch((e) => {
        if (
          !controller.signal.aborted &&
          !(id === null && e instanceof ApiClientError && e.status === 404)
        ) {
          setError(person1Error(e));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [account]);
  useEffect(
    () => () => {
      if (lastPreview.current) URL.revokeObjectURL(lastPreview.current);
    },
    [],
  );
  function change(name: keyof Omit<BuilderContent, "sections">, value: string) {
    setContent((c) => ({ ...c, [name]: value }));
  }
  async function pdf(download = false) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const blob = await renderCvPdf(content, template);
      if (download) saveBlob(blob, "cv.pdf");
      else {
        if (lastPreview.current) URL.revokeObjectURL(lastPreview.current);
        lastPreview.current = URL.createObjectURL(blob);
        setPreview(lastPreview.current);
      }
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formIssue = person1FormError(e.currentTarget);
    if (formIssue) { setError(formIssue); return; }
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const fingerprint = JSON.stringify({ content, template, title });
      let fileId =
        staged.current?.fingerprint === fingerprint
          ? staged.current.fileId
          : null;
      if (!fileId) {
        const blob = await renderCvPdf(content, template);
        fileId = await uploadPersonalFile(
          new File([blob], "cv.pdf", { type: "application/pdf" }),
          "CV",
        );
        staged.current = { fingerprint, fileId };
      }
      const body = {
        title: title.trim(),
        templateId: template,
        contentSchemaVersion: 1,
        contentJson: content,
        fileId,
        ...(original
          ? { expectedAggregateVersion: original.aggregateVersion }
          : {}),
      };
      await requestApi(
        original
          ? `/profile/cvs/${original.id}/revisions`
          : "/profile/cvs/online",
        { method: "POST", privateData: true, body },
      );
      router.push("/candidate/profile/cvs");
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  function move(index: number, delta: number) {
    setContent((c) => {
      const sections = [...c.sections];
      [sections[index], sections[index + delta]] = [
        sections[index + delta],
        sections[index],
      ];
      return { ...c, sections };
    });
  }
  return (
    <main className="form-stack">
      <div className="page-header">
        <h1>{original ? "Chỉnh sửa CV" : "Tạo CV trực tuyến"}</h1>
        <Link className="btn" href="/candidate/profile/cvs">
          Danh sách CV
        </Link>
      </div>
      {loading ? (
        <p role="status">Đang tải nội dung…</p>
      ) : (
        <form className="card form-stack" noValidate onSubmit={save}>
          <fieldset
            disabled={pending || loadFailed}
            className="person1-fieldset form-stack"
          >
            <label className="field">
              Tên CV
              <input
                className="input"
                value={title}
                required
                maxLength={160}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Mẫu CV
              <select
                className="select"
                value={template}
                onChange={(e) => setTemplate(e.target.value as typeof template)}
              >
                <option value="modern">Hiện đại</option>
                <option value="classic">Cổ điển</option>
              </select>
            </label>
            {(["fullName", "headline", "contact", "summary"] as const).map(
              (key, index) => (
                <label className="field" key={key}>
                  {
                    [
                      "Họ tên",
                      "Vị trí mong muốn",
                      "Thông tin liên hệ",
                      "Giới thiệu",
                    ][index]
                  }
                  <textarea
                    className="textarea resize-none"
                    required={key === "fullName"}
                    maxLength={key === "summary" ? 5000 : 1000}
                    value={content[key]}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
              ),
            )}
            {content.sections.map((section, index) => (
              <section className="person1-builder-section" key={index}>
                <label className="field">
                  Tên mục
                  <input
                    className="input"
                    required
                    maxLength={100}
                    value={section.title}
                    onChange={(e) =>
                      setContent((c) => ({
                        ...c,
                        sections: c.sections.map((s, i) =>
                          i === index ? { ...s, title: e.target.value } : s,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  Nội dung
                  <textarea
                    className="textarea resize-none"
                    rows={5}
                    maxLength={5000}
                    value={section.text}
                    onChange={(e) =>
                      setContent((c) => ({
                        ...c,
                        sections: c.sections.map((s, i) =>
                          i === index ? { ...s, text: e.target.value } : s,
                        ),
                      }))
                    }
                  />
                </label>
                <div className="btn-group">
                  <button
                    className="btn"
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Lên
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={index === content.sections.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Xuống
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      setContent((c) => ({
                        ...c,
                        sections: c.sections.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Bỏ mục
                  </button>
                </div>
              </section>
            ))}
            <button
              className="btn"
              type="button"
              disabled={content.sections.length >= 10}
              onClick={() =>
                setContent((c) => ({
                  ...c,
                  sections: [...c.sections, { title: "Mục mới", text: "" }],
                }))
              }
            >
              Thêm mục
            </button>
            <div className="btn-group">
              <button className="btn" type="button" onClick={() => void pdf()}>
                Xem trước PDF
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => void pdf(true)}
              >
                Xuất PDF
              </button>
              <button className="btn btn-primary">
                {pending ? "Đang lưu…" : "Lưu CV"}
              </button>
            </div>
          </fieldset>
          {original ? (
            <p className="help">
              Lưu tạo phiên bản CV mới. Bản đã dùng trong đơn ứng tuyển được giữ
              nguyên.
            </p>
          ) : null}
        </form>
      )}
      {error ? (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <section className="card">
          <h2>Bản xem trước PDF</h2>
          <p>Nhấn xem trước lần nữa sau khi chỉnh sửa.</p>
          <iframe
            className="person1-pdf"
            src={preview}
            title="Bản xem trước CV PDF"
          />
        </section>
      ) : null}
    </main>
  );
}
