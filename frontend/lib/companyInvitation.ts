const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function normalizeInvitationEmail(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

export function validateInvitationEmail(value: string): string | null {
  const normalized = normalizeInvitationEmail(value);
  if (!normalized) return "Nhập email người được mời.";
  if (normalized.length > 320) return "Email không được vượt quá 320 ký tự.";
  if (!SIMPLE_EMAIL_PATTERN.test(normalized)) return "Email chưa đúng định dạng.";
  return null;
}
