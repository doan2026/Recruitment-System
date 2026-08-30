"use client";

import { useEffect, useState } from "react";
import {
  moveCompanyMediaItem,
  normalizeCompanyMediaLibrary,
  validateCompanyMediaLibrary,
} from "../lib/companyMediaLibrary";
import { toUserMessage } from "../lib/apiClient";
import { type Company, updateCompany } from "../lib/person2Api";

export function CompanyMediaLibrary({ company, onCompanyChange }: {
  company: Company;
  onCompanyChange: (company: Company) => void;
}) {
  const [items, setItems] = useState(() => normalizeCompanyMediaLibrary(company.media.gallery));
  const [removeLogo, setRemoveLogo] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setItems(normalizeCompanyMediaLibrary(company.media.gallery));
    setRemoveLogo(false);
  }, [company.aggregateVersion, company.media.gallery]);

  const images = items.filter((item) => item.type === "IMAGE").length;
  const videos = items.filter((item) => item.type === "VIDEO").length;
  const dirty = removeLogo || items.some((item, index) =>
    item.fileId !== company.media.gallery[index]?.fileId || item.sortOrder !== index
  ) || items.length !== company.media.gallery.length;

  function move(fileId: string, targetIndex: number) {
    setItems((current) => moveCompanyMediaItem(current, fileId, targetIndex));
    setStatus("");
  }

  async function saveLibrary() {
    if (pending || !dirty) return;
    const validationError = validateCompanyMediaLibrary(removeLogo ? undefined : company.media.logo?.fileId, items);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPending(true);
    setError("");
    setStatus("");
    try {
      const response = await updateCompany(company.id, {
        media: normalizeCompanyMediaLibrary(items).map(({ fileId, type, sortOrder }) => ({ fileId, type, sortOrder })),
        removeLogo: removeLogo || undefined,
      });
      onCompanyChange(response.data);
      setStatus("Đã lưu toàn bộ thứ tự và nội dung thư viện.");
    } catch (reason: unknown) {
      setError(toUserMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-head">
        <div><h2>Thư viện công ty</h2><p className="help">Kéo thả hoặc dùng nút để đổi thứ tự. Lưu sẽ thay thế toàn bộ gallery.</p></div>
        <span className="help">{images}/10 ảnh · {videos}/1 video</span>
      </div>
      <div className="card media-library-logo">
        <div><strong>Logo chính</strong><p className="help">{company.media.logo?.fileId ?? "Chưa có logo"}</p></div>
        {company.media.logo ? <button className="btn btn-danger" type="button" disabled={pending} onClick={() => setRemoveLogo((value) => !value)}>{removeLogo ? "Giữ logo" : "Xóa logo khi lưu"}</button> : null}
      </div>
      <div className="grid-3 media-library-grid" aria-label="Media có thể sắp xếp">
        {items.map((item, index) => (
          <article
            className="card media-library-item"
            key={item.fileId}
            draggable={!pending}
            onDragStart={() => setDraggedId(item.fileId)}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { if (draggedId) move(draggedId, index); setDraggedId(null); }}
          >
            <strong>{item.type === "VIDEO" ? "Video" : `Ảnh ${index + 1}`}</strong>
            <p className="help">{item.fileId}</p>
            <div className="btn-group">
              <button className="btn" type="button" disabled={pending || index === 0} onClick={() => move(item.fileId, index - 1)} aria-label={`Đưa ${item.fileId} lên trước`}>←</button>
              <button className="btn" type="button" disabled={pending || index === items.length - 1} onClick={() => move(item.fileId, index + 1)} aria-label={`Đưa ${item.fileId} xuống sau`}>→</button>
              <button className="btn btn-danger" type="button" disabled={pending} onClick={() => setItems((current) => normalizeCompanyMediaLibrary(current.filter((value) => value.fileId !== item.fileId)))}>Xóa</button>
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 ? <p className="notice">Thư viện chưa có ảnh hoặc video.</p> : null}
      {status ? <p className="notice notice-success" role="status">{status}</p> : null}
      {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
      <div className="btn-group">
        <button className="btn btn-primary" type="button" disabled={pending || !dirty} aria-busy={pending} onClick={() => { void saveLibrary(); }}>{pending ? "Đang lưu…" : "Lưu toàn bộ thư viện"}</button>
        <button className="btn" type="button" disabled={pending || !dirty} onClick={() => { setItems(normalizeCompanyMediaLibrary(company.media.gallery)); setRemoveLogo(false); setError(""); }}>Hoàn tác</button>
      </div>
    </section>
  );
}
