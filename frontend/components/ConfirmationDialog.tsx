"use client";

import { useEffect, useId, useRef } from "react";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function cancel() {
    if (!pending) onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div className="confirmation-dialog-card">
        <p className="eyebrow">CẦN BẠN XÁC NHẬN</p>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
        <div className="btn-group confirmation-dialog-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? "Đang lưu…" : confirmLabel}
          </button>
          <button ref={cancelRef} className="btn" type="button" disabled={pending} onClick={cancel}>
            Quay lại
          </button>
        </div>
      </div>
    </dialog>
  );
}
