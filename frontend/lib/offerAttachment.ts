import { ApiClientError, assertCanonicalUuidV4 } from "./apiClientCore";

export interface ConfirmedOfferAttachment {
  fileId: string;
  fileUrl: string;
}

export const OFFER_ATTACHMENT_SUPPORT = Object.freeze({
  available: false,
  title: "File Offer chưa khả dụng",
  description:
    "Media Service chưa có policy OFFER_LETTER nên chưa thể xác nhận file và URL canonical. Bạn vẫn có thể gửi Offer không đính kèm file.",
});

export function normalizeOfferAttachment(input: {
  fileId?: string | null;
  fileUrl?: string | null;
}): ConfirmedOfferAttachment | null {
  const fileId = input.fileId?.trim() || null;
  const fileUrl = input.fileUrl?.trim() || null;
  if (Boolean(fileId) !== Boolean(fileUrl)) {
    throw new ApiClientError({ code: "INVALID_OFFER_FILE_PAIR" });
  }
  if (!fileId || !fileUrl) return null;

  assertCanonicalUuidV4(fileId, "fileId");
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw new ApiClientError({ code: "INVALID_OFFER_FILE_URL" });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ApiClientError({ code: "INVALID_OFFER_FILE_URL" });
  }
  return { fileId, fileUrl: parsed.toString() };
}

export function emptyOfferAttachment(): { fileId: undefined; fileUrl: undefined } {
  return { fileId: undefined, fileUrl: undefined };
}
