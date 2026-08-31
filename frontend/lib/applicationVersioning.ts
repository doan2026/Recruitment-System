import { ApiClientError } from "./apiClientCore";
import { emptyOfferAttachment, normalizeOfferAttachment } from "./offerAttachment";
import type { ApplicationStatus } from "./demoData";

export type OfferDecision = "ACCEPTED" | "DECLINED";

function exactVersion(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiClientError({ code: "INVALID_EXPECTED_VERSION", details: { field } });
  }
  return value;
}

export function buildApplicationStatusCommand(input: {
  status: ApplicationStatus;
  note?: string;
  applicationVersion: number;
}) {
  return {
    status: input.status,
    note: input.note?.trim() || undefined,
    expectedVersion: exactVersion(input.applicationVersion, "expectedVersion"),
  };
}

export function buildApplicationWithdrawCommand(input: {
  note?: string;
  applicationVersion: number;
}) {
  return {
    note: input.note?.trim() || undefined,
    expectedVersion: exactVersion(input.applicationVersion, "expectedVersion"),
  };
}

export function buildMatchRefreshCommand(applicationVersion: number) {
  return { expectedVersion: exactVersion(applicationVersion, "expectedVersion") };
}

export interface SendOfferValues {
  salary: number;
  startDate: string;
  position: string;
  note?: string;
  fileId?: string;
  fileUrl?: string;
  expiresAt: string;
  applicationVersion: number;
}

export function buildSendOfferCommand(input: SendOfferValues) {
  const attachment = normalizeOfferAttachment(input) ?? emptyOfferAttachment();
  return {
    salary: input.salary,
    startDate: input.startDate,
    position: input.position.trim(),
    note: input.note?.trim() || undefined,
    fileId: attachment.fileId,
    fileUrl: attachment.fileUrl,
    expiresAt: input.expiresAt,
    expectedApplicationVersion: exactVersion(input.applicationVersion, "expectedApplicationVersion"),
  };
}

export function buildOfferResponseCommand(input: {
  decision: OfferDecision;
  declineReason?: string;
  offerVersion: number;
  applicationVersion: number;
}) {
  return {
    decision: input.decision,
    declineReason: input.declineReason?.trim() || undefined,
    expectedOfferVersion: exactVersion(input.offerVersion, "expectedOfferVersion"),
    expectedApplicationVersion: exactVersion(input.applicationVersion, "expectedApplicationVersion"),
  };
}

export function nextApplicationVersion(response: { version: number }): number {
  return exactVersion(response.version, "version");
}

export function nextOfferVersions(response: { version: number; applicationVersion: number }) {
  return {
    offerVersion: exactVersion(response.version, "version"),
    applicationVersion: exactVersion(response.applicationVersion, "applicationVersion"),
  };
}
