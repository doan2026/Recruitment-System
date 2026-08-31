import { ApiClientError } from "./apiClientCore";

export const AI_CHAT_MAX_CHARACTERS = 2_000;
export const AI_CHAT_MAX_UTF8_BYTES = 8_000;

export interface AiChatMessageValidation {
  value: string;
  characterCount: number;
  byteCount: number;
  errorCode: string | null;
  errorMessage: string | null;
}

function isForbiddenControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (codePoint < 32 && character !== "\n" && character !== "\t")
    || (codePoint >= 127 && codePoint <= 159);
}

export function validateAiChatMessage(rawValue: string): AiChatMessageValidation {
  const value = rawValue.normalize("NFC").trim();
  const characterCount = Array.from(value).length;
  const byteCount = new TextEncoder().encode(value).byteLength;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  if (!value) {
    errorCode = "CHAT_MESSAGE_REQUIRED";
    errorMessage = "Hãy nhập nội dung trước khi gửi.";
  } else if (byteCount > AI_CHAT_MAX_UTF8_BYTES) {
    errorCode = "CHAT_MESSAGE_TOO_MANY_BYTES";
    errorMessage = "Tin nhắn vượt quá 8.000 byte UTF-8.";
  } else if (Array.from(value).some(isForbiddenControlCharacter)) {
    errorCode = "CHAT_MESSAGE_CONTROL_CHARACTER";
    errorMessage = "Tin nhắn chứa ký tự điều khiển không được hỗ trợ.";
  } else if (characterCount > AI_CHAT_MAX_CHARACTERS) {
    errorCode = "CHAT_MESSAGE_TOO_LONG";
    errorMessage = "Tin nhắn không được vượt quá 2.000 ký tự.";
  }

  return { value, characterCount, byteCount, errorCode, errorMessage };
}

export function normalizeAiChatMessage(rawValue: string): string {
  const validation = validateAiChatMessage(rawValue);
  if (validation.errorCode) {
    throw new ApiClientError({
      code: validation.errorCode,
      status: 422,
      details: { characterCount: validation.characterCount, byteCount: validation.byteCount },
    });
  }
  return validation.value;
}
