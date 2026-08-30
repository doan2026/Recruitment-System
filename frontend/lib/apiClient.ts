export * from "./apiClientCore";

import {
  ApiClientError,
  type ApiEnvelope,
  type ApiErrorPayload,
} from "./apiClientCore";

/** Compatibility helper for the original demo adapter. New code should use requestApi. */
export async function requestEnvelope<T>(
  call: () => Promise<ApiEnvelope<T> | ApiErrorPayload>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ApiClientError({ code: "TIMEOUT" })),
          timeoutMs,
        );
      }),
    ]);
    if ("code" in result) {
      throw new ApiClientError({ code: result.code, details: result.details });
    }
    return result.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
