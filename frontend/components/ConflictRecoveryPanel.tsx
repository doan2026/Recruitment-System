"use client";

import { useEffect, useId, useRef } from "react";
import type { ConflictSnapshot } from "../lib/conflictRecovery";

export function ConflictRecoveryPanel<TDraft, TServer>({
  resourceName,
  snapshot,
  onUseServer,
  onKeepDraft,
}: {
  resourceName: string;
  snapshot: ConflictSnapshot<TDraft, TServer>;
  onUseServer: () => void;
  onKeepDraft: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, [snapshot]);

  return (
    <section className="conflict-panel" role="alert" aria-labelledby={headingId}>
      <div className="conflict-heading-row">
        <div>
          <p className="eyebrow">CẦN BẠN QUYẾT ĐỊNH</p>
          <h3 id={headingId} ref={headingRef} tabIndex={-1}>
            {resourceName} vừa được người khác sửa
          </h3>
        </div>
        {snapshot.localVersion !== null && snapshot.serverVersion !== null ? (
          <span className="badge badge-warning">
            v{snapshot.localVersion} → v{snapshot.serverVersion}
          </span>
        ) : null}
      </div>

      <p>
        Dữ liệu bạn nhập vẫn được giữ. Hệ thống đã tải bản mới nhất để bạn so sánh và chưa tự gửi lại thay đổi.
      </p>

      <div className="table-wrap">
        <table className="data-table conflict-table">
          <caption>So sánh dữ liệu bạn nhập với bản mới nhất trên hệ thống</caption>
          <thead>
            <tr>
              <th scope="col">Trường</th>
              <th scope="col">Bản bạn nhập</th>
              <th scope="col">Bản mới nhất</th>
              <th scope="col">Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.fields.map((field) => (
              <tr key={field.key}>
                <th scope="row">{field.label}</th>
                <td>{field.localValue}</td>
                <td>{field.serverValue}</td>
                <td>
                  <span className={`badge ${field.changed ? "badge-warning" : "badge-neutral"}`}>
                    {field.changed ? "Khác nhau" : "Không đổi"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="help">
        Chọn giữ bản của bạn chỉ cập nhật dữ liệu nền. Hãy kiểm tra lại dữ liệu và chủ động thực hiện lại thao tác để gửi lần nữa.
      </p>
      <div className="btn-group">
        <button className="btn btn-primary" type="button" onClick={onKeepDraft}>
          Giữ bản tôi vừa nhập
        </button>
        <button className="btn btn-secondary" type="button" onClick={onUseServer}>
          Dùng dữ liệu mới nhất
        </button>
      </div>
    </section>
  );
}
