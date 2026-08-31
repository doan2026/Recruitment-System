import { ApiClientError } from "./apiClientCore";

const CANONICAL_UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const NUMBERED_JOB_LINE = new RegExp(`^(\\d{1,2})\\.\\s+(.+?\\b(?:mã việc|job ID)\\s+(${CANONICAL_UUID_V4}))$`, "i");
const SUITABLE_JOBS_INTENT = /(?:Suitable Jobs screen|màn [“"]Việc làm phù hợp[”"])/iu;

export interface AiChatJobLine {
  number: number;
  text: string;
  jobId: string;
}

export interface AiChatResponsePresentation {
  text: string;
  introduction: string;
  jobLines: AiChatJobLine[];
  conclusion: string;
  hasSuitableJobsIntent: boolean;
}

function hasUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint < 32 && character !== "\n" && character !== "\t")
      || (codePoint >= 127 && codePoint <= 159);
  });
}

export function normalizeAiChatAnswer(rawAnswer: string): string {
  const answer = typeof rawAnswer === "string" ? rawAnswer.normalize("NFC").trim() : "";
  if (!answer || Array.from(answer).length > 8_000 || hasUnsafeControl(answer)) {
    throw new ApiClientError({ code: "INVALID_API_RESPONSE" });
  }
  return answer;
}

export function presentAiChatResponse(rawAnswer: string): AiChatResponsePresentation {
  const text = normalizeAiChatAnswer(rawAnswer);
  const lines = text.split("\n");
  const firstJobIndex = lines.findIndex((line) => NUMBERED_JOB_LINE.test(line));
  let lastJobIndex = firstJobIndex;
  const jobLines: AiChatJobLine[] = [];

  if (firstJobIndex >= 0) {
    while (lastJobIndex < lines.length) {
      const match = NUMBERED_JOB_LINE.exec(lines[lastJobIndex]);
      if (!match) break;
      jobLines.push({ number: Number(match[1]), text: match[2], jobId: match[3] });
      lastJobIndex += 1;
    }
  }

  const hasStableSequence = jobLines.length > 0
    && jobLines.every((item, index) => item.number === index + 1);
  return {
    text,
    introduction: hasStableSequence ? lines.slice(0, firstJobIndex).join("\n") : "",
    jobLines: hasStableSequence ? jobLines : [],
    conclusion: hasStableSequence ? lines.slice(lastJobIndex).join("\n") : "",
    hasSuitableJobsIntent: SUITABLE_JOBS_INTENT.test(text),
  };
}
