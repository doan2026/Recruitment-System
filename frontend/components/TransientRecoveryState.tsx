"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toUserMessage } from "../lib/apiClient";
import { createTransientRecoveryPlan } from "../lib/transientRecovery";
import { ErrorState } from "./ui";

export function TransientRecoveryState({
  error,
  failureCount,
  onRetry,
}: {
  error: unknown;
  failureCount: number;
  onRetry: () => void;
}) {
  const plan = createTransientRecoveryPlan(error, failureCount);
  const [remainingSeconds, setRemainingSeconds] = useState(plan?.delaySeconds ?? 0);
  const [retrying, setRetrying] = useState(false);
  const retryRef = useRef(onRetry);
  const triggeredRef = useRef(false);
  const headingId = useId();

  useEffect(() => {
    retryRef.current = onRetry;
  }, [onRetry]);

  const retry = useCallback(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    setRetrying(true);
    retryRef.current();
  }, []);

  useEffect(() => {
    if (!plan) return;
    triggeredRef.current = false;
    setRetrying(false);
    const deadline = Date.now() + plan.delaySeconds * 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        if (plan.automatic) retry();
        return;
      }
      timer = setTimeout(tick, Math.min(1_000, remaining * 1_000));
    };

    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [error, failureCount, plan?.automatic, plan?.delaySeconds, retry]);

  if (!plan) return <ErrorState message={toUserMessage(error)} onRetry={onRetry} />;

  const hasServerSchedule = plan.source === "retry-after";
  const autoRetryPending = plan.automatic && !retrying;
  const buttonLabel = retrying
    ? "Đang thử lại…"
    : remainingSeconds > 0
      ? `Thử lại sau ${remainingSeconds} giây`
      : "Thử lại";

  return (
    <section className="notice notice-warning transient-recovery" aria-labelledby={headingId}>
      <strong id={headingId}>
        {plan.status === 429 ? "Đang có quá nhiều yêu cầu" : "Dịch vụ tạm thời chưa sẵn sàng"}
      </strong>
      <p>
        {hasServerSchedule
          ? plan.automatic
            ? "Hệ thống đã cung cấp thời gian chờ và sẽ tự thử lại một lần."
            : "Lần tự thử lại đã dùng hết. Bạn có thể chủ động thử lại sau thời gian chờ."
          : "Không có thời gian chờ từ máy chủ. CareerHub áp dụng backoff cục bộ trước khi mở lại thao tác."}
      </p>
      <p className="help" role="status" aria-live="polite">
        {remainingSeconds > 0
          ? `Có thể thử lại sau ${remainingSeconds} giây.`
          : retrying
            ? "Đang gửi lại yêu cầu."
            : "Bạn có thể thử lại ngay."}
      </p>
      <button
        className="btn btn-secondary"
        type="button"
        disabled={remainingSeconds > 0 || retrying || autoRetryPending}
        aria-busy={retrying}
        onClick={retry}
      >
        {buttonLabel}
      </button>
    </section>
  );
}
