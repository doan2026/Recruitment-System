import { ApiClientError } from "./apiClientCore";

export interface RecruiterCvDownload {
  cvId: string;
  url: string;
  expiresAt: string;
}

export function isCvDownloadFresh(download: RecruiterCvDownload, now = Date.now()): boolean {
  const expiresAt = Date.parse(download.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  try {
    const url = new URL(download.url);
    if (url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return expiresAt > now + 1_000;
}

export async function resolveFreshCvDownload(
  createDownload: () => Promise<RecruiterCvDownload>,
  now: () => number = Date.now,
): Promise<RecruiterCvDownload> {
  const first = await createDownload();
  if (isCvDownloadFresh(first, now())) return first;
  const refreshed = await createDownload();
  if (!isCvDownloadFresh(refreshed, now())) {
    throw new ApiClientError({ code: "CV_DOWNLOAD_EXPIRED" });
  }
  return refreshed;
}
