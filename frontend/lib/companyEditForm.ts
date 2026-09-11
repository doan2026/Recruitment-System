import {
  normalizeCompanyCreate,
  type CompanyCreateValues,
} from "./companyForm";
import type { ConflictFieldDefinition } from "./conflictRecovery";
import type { Company } from "./demoData";

export type CompanyEditValues = CompanyCreateValues;
export { validateCompanyCreate as validateCompanyEdit } from "./companyForm";

export function companyEditValues(company: Company): CompanyEditValues {
  return {
    name: company.name,
    taxCode: company.taxCode,
    description: company.description ?? "",
    industry: company.industry ?? "",
    size: company.size ?? "",
    address: company.address ?? "",
    website: company.website ?? "",
  };
}

/** The caller must supply the snapshot loaded into the form, not a background refresh. */
export function buildCompanyEditUpdate(values: CompanyEditValues, snapshot: Company) {
  return {
    ...normalizeCompanyCreate(values),
    // Clearing the optional field must remove the saved website, not omit the update.
    website: values.website.trim() || null,
    expectedVersion: snapshot.aggregateVersion,
  };
}

export function isCompanyEditDirty(values: CompanyEditValues, snapshot: Company): boolean {
  const original = companyEditValues(snapshot);
  return (Object.keys(original) as (keyof CompanyEditValues)[])
    .some((field) => values[field] !== original[field]);
}

const COMPANY_FIELD_LABELS: Record<keyof CompanyEditValues, string> = {
  name: "Tên công ty",
  taxCode: "Mã số thuế",
  description: "Mô tả công ty",
  industry: "Lĩnh vực",
  size: "Quy mô",
  address: "Địa chỉ",
  website: "Website",
};

export const COMPANY_EDIT_CONFLICT_FIELDS: readonly ConflictFieldDefinition<CompanyEditValues, Company>[] =
  (Object.entries(COMPANY_FIELD_LABELS) as [keyof CompanyEditValues, string][]).map(([key, label]) => ({
    key,
    label,
    localValue: (draft) => draft[key].trim(),
    serverValue: (server) => companyEditValues(server)[key].trim(),
  }));
