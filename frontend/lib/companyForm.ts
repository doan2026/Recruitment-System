export interface CompanyCreateValues {
  name: string;
  description: string;
  industry: string;
  size: string;
  address: string;
  website: string;
  taxCode: string;
}

export type CompanyCreateField = keyof CompanyCreateValues;
export type CompanyCreateErrors = Partial<Record<CompanyCreateField, string>>;

export const emptyCompanyCreateValues: CompanyCreateValues = {
  name: "",
  description: "",
  industry: "",
  size: "",
  address: "",
  website: "",
  taxCode: "",
};

function requiredLength(
  value: string,
  label: string,
  min: number,
  max: number,
): string | undefined {
  const length = value.trim().length;
  if (length === 0) return `Nhập ${label}.`;
  if (length < min) return `${label} cần ít nhất ${min} ký tự.`;
  if (length > max) return `${label} không được quá ${max.toLocaleString("vi-VN")} ký tự.`;
  return undefined;
}

export function validateCompanyCreate(values: CompanyCreateValues): CompanyCreateErrors {
  const errors: CompanyCreateErrors = {
    name: requiredLength(values.name, "tên công ty", 2, 160),
    description: requiredLength(values.description, "mô tả", 1, 10_000),
    industry: requiredLength(values.industry, "lĩnh vực", 1, 120),
    size: requiredLength(values.size, "quy mô", 1, 50),
    address: requiredLength(values.address, "địa chỉ", 1, 500),
    taxCode: requiredLength(values.taxCode, "mã số thuế", 1, 32),
  };

  const website = values.website.trim();
  if (website.length > 2_048) {
    errors.website = "Website không được quá 2.048 ký tự.";
  } else if (website) {
    try {
      const url = new URL(website);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.website = "Website phải bắt đầu bằng http:// hoặc https://.";
      }
    } catch {
      errors.website = "Nhập địa chỉ website hợp lệ, gồm cả http:// hoặc https://.";
    }
  }

  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => message !== undefined),
  ) as CompanyCreateErrors;
}

export function normalizeCompanyCreate(values: CompanyCreateValues) {
  const website = values.website.trim();
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    industry: values.industry.trim(),
    size: values.size.trim(),
    address: values.address.trim(),
    website: website || undefined,
    taxCode: values.taxCode.trim(),
  };
}
