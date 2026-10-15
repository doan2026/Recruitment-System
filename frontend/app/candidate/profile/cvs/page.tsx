"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { requestApi } from "../../../../lib/apiClient";
import {
  person1Error,
  uploadPersonalFile,
  type CandidateCv,
} from "../../../../lib/person1Api";
import { ConfirmationDialog } from "../../../../components/ConfirmationDialog";
export default function CvsPage() {
  const [cvs, setCvs] = useState<CandidateCv[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [rename, setRename] = useState<CandidateCv | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [deleting, setDeleting] = useState<CandidateCv | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    requestApi<CandidateCv[]>("/profile/cvs", {
      privateData: true,
      signal: controller.signal,
    })
      .then((r) => setCvs(r.data))
      .catch((e) => {
        if (!controller.signal.aborted) setError(person1Error(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (pending || !file) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const fileId = uploaded ?? (await uploadPersonalFile(file, "CV"));
      setUploaded(fileId);
      await requestApi("/profile/cvs", {
        method: "POST",
        privateData: true,
        body: { title: title.trim(), fileId },
      });
      setFile(null);
      setUploaded(null);
      setTitle("");
      setNotice("Đã lưu CV.");
      setReload((n) => n + 1);
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  async function mutate(
    cv: CandidateCv,
    kind: "rename" | "default" | "delete",
  ) {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await requestApi<{ deletionMode?: string }>(
        `/profile/cvs/${cv.id}${kind === "default" ? "/default" : ""}`,
        {
          method: kind === "delete" ? "DELETE" : "PATCH",
          privateData: true,
          body: {
            expectedAggregateVersion: cv.aggregateVersion,
            ...(kind === "rename" ? { title: newTitle.trim() } : {}),
          },
        },
      );
      setNotice(
        result.data.deletionMode === "PENDING"
          ? "CV đã được ẩn. Hệ thống đang kiểm tra tham chiếu ứng tuyển trước khi hoàn tất xóa."
          : "Đã cập nhật CV.",
      );
      setDeleting(null);
      setRename(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  async function download(cv: CandidateCv) {
    setPending(true);
    setError("");
    try {
      const r = await requestApi<{ url: string }>(
        `/profile/cvs/${cv.id}/download-url`,
        { method: "POST", privateData: true },
      );
      const url = new URL(r.data.url);
      if (url.protocol !== "https:")
        throw new Error("Liên kết tải không hợp lệ.");
      const link = document.createElement("a");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="form-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">HỒ SƠ · CV</p>
          <h1>CV của tôi</h1>
          <p>{cvs.length}/5 CV đang hoạt động</p>
        </div>
        <div className="btn-group">
          <Link className="btn" href="/candidate/profile">
            Hồ sơ
          </Link>
          <Link
            className="btn btn-primary"
            href="/candidate/profile/cvs/builder"
          >
            Tạo CV trực tuyến
          </Link>
        </div>
      </div>
      <form className="card form-stack" onSubmit={upload}>
        <h2>Tải CV PDF</h2>
        <fieldset
          disabled={pending || loading || cvs.length >= 5}
          className="form-stack person1-fieldset"
        >
          <label className="field">
            Tên CV
            <input
              className="input"
              value={title}
              maxLength={160}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Tệp PDF, tối đa 5 MB
            <input
              className="input"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setUploaded(null);
              }}
            />
          </label>
          <button className="btn btn-primary" disabled={!file}>
            {pending ? "Đang lưu…" : "Tải lên và lưu CV"}
          </button>
        </fieldset>
        {cvs.length >= 5 ? (
          <p className="notice notice-warning">
            Bạn đã có 5 CV. Xóa bớt trước khi thêm mới.
          </p>
        ) : null}
      </form>
      {loading ? (
        <p role="status">Đang tải CV…</p>
      ) : cvs.length ? (
        <section className="person1-grid">
          {cvs.map((cv) => (
            <article className="card form-stack" key={cv.id}>
              <h2>{cv.title}</h2>
              <p>
                {cv.type === "ONLINE" ? "CV trực tuyến" : "CV tải lên"}
                {cv.isDefault ? " · Mặc định" : ""}
              </p>
              <p>{new Date(cv.createdAt).toLocaleDateString("vi-VN")}</p>
              <div className="btn-group">
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => void download(cv)}
                >
                  Tải xuống
                </button>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => {
                    setRename(cv);
                    setNewTitle(cv.title);
                  }}
                >
                  Đổi tên
                </button>
                {!cv.isDefault ? (
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() => void mutate(cv, "default")}
                  >
                    Đặt mặc định
                  </button>
                ) : null}
                {cv.type === "ONLINE" ? (
                  <Link
                    className="btn"
                    href={`/candidate/profile/cvs/builder?id=${cv.id}`}
                  >
                    Sửa nội dung
                  </Link>
                ) : null}
                <button
                  className="btn btn-danger"
                  disabled={pending}
                  onClick={() => setDeleting(cv)}
                >
                  Xóa CV
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="card">
          <h2>Chưa có CV</h2>
          <p>Tải PDF hoặc tạo CV trực tuyến để bắt đầu ứng tuyển.</p>
        </section>
      )}
      {rename ? (
        <form
          className="card form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(rename, "rename");
          }}
        >
          <h2>Đổi tên CV</h2>
          <label className="field">
            Tên mới
            <input
              className="input"
              autoFocus
              required
              maxLength={160}
              disabled={pending}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </label>
          <div className="btn-group">
            <button className="btn btn-primary" disabled={pending}>
              Lưu tên
            </button>
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={() => setRename(null)}
            >
              Hủy
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <div role="alert" className="notice notice-danger">
          {error}
          <button
            className="btn"
            disabled={pending}
            onClick={() => {
              setDeleting(null);
              setRename(null);
              setReload((n) => n + 1);
            }}
          >
            Tải lại danh sách
          </button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      <ConfirmationDialog
        open={!!deleting}
        title={"Xóa " + (deleting?.title ?? "CV")}
        description="CV đã dùng ứng tuyển được giữ lại cho hồ sơ ứng tuyển. Nếu xóa CV mặc định, một CV còn lại sẽ được chọn thay thế."
        confirmLabel="Xóa CV"
        pending={pending}
        onConfirm={() => {
          if (deleting) void mutate(deleting, "delete");
        }}
        onCancel={() => setDeleting(null)}
      />
    </main>
  );
}
