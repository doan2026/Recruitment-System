export interface ApiEnvelope<T> {
  data: T;
  meta: Record<string, unknown> | null;
}

export const success = <T>(
  data: T,
  meta: Record<string, unknown> | null = null,
): ApiEnvelope<T> => ({ data, meta });
