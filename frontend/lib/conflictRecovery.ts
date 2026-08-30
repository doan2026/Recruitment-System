import { ApiClientError } from "./apiClientCore";

const OPTIMISTIC_CONFLICT_CODES = new Set([
  "APPLICATION_CHANGED_CONCURRENTLY",
  "JOB_STATE_CHANGED",
  "COMPANY_UPDATE_CONFLICT",
]);

export type ConflictValue = string | number | boolean | null | undefined;

export interface ConflictFieldDefinition<TDraft, TServer> {
  key: string;
  label: string;
  localValue: (draft: TDraft) => ConflictValue;
  serverValue: (server: TServer) => ConflictValue;
  format?: (value: ConflictValue) => string;
}

export interface ConflictFieldComparison {
  key: string;
  label: string;
  localValue: string;
  serverValue: string;
  changed: boolean;
}

export interface ConflictSnapshot<TDraft, TServer> {
  code: string;
  localDraft: TDraft;
  server: TServer;
  localVersion: number | null;
  serverVersion: number | null;
  fields: ConflictFieldComparison[];
}

function displayValue(value: ConflictValue): string {
  if (value === null || value === undefined || value === "") return "Để trống";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  return String(value);
}

export function isOptimisticConflict(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError &&
    error.status === 409 &&
    OPTIMISTIC_CONFLICT_CODES.has(error.code);
}

export async function prepareConflictSnapshot<TDraft, TServer>({
  error,
  localDraft,
  reload,
  fields,
  localVersion,
  serverVersion,
}: {
  error: unknown;
  localDraft: TDraft;
  reload: () => Promise<TServer>;
  fields: readonly ConflictFieldDefinition<TDraft, TServer>[];
  localVersion?: number | null;
  serverVersion?: (server: TServer) => number | null;
}): Promise<ConflictSnapshot<TDraft, TServer>> {
  if (!isOptimisticConflict(error)) throw error;

  const server = await reload();
  return {
    code: error.code,
    localDraft,
    server,
    localVersion: localVersion ?? null,
    serverVersion: serverVersion?.(server) ?? null,
    fields: fields.map((field) => {
      const localRaw = field.localValue(localDraft);
      const serverRaw = field.serverValue(server);
      const format = field.format ?? displayValue;
      return {
        key: field.key,
        label: field.label,
        localValue: format(localRaw),
        serverValue: format(serverRaw),
        changed: localRaw !== serverRaw,
      };
    }),
  };
}
