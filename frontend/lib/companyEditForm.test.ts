import assert from "node:assert/strict";
import test from "node:test";
import { ApiClientError } from "./apiClientCore";
import { prepareConflictSnapshot } from "./conflictRecovery";
import type { Company } from "./demoData";
import {
  buildCompanyEditUpdate,
  COMPANY_EDIT_CONFLICT_FIELDS,
  companyEditValues,
  isCompanyEditDirty,
  validateCompanyEdit,
  type CompanyEditValues,
} from "./companyEditForm";

const company: Company = {
  id: "3795c0de-7908-4ab5-9bed-4c4f1cf9c212",
  name: "Công ty Sản phẩm Việt",
  shortName: "san-pham-viet",
  taxCode: "0012345678",
  ownerName: "OWNER",
  description: "Mô tả ban đầu.\nDòng thứ hai.",
  industry: "Công nghệ",
  size: "51–200 nhân sự",
  address: "Hà Nội",
  website: "https://example.vn",
  aggregateVersion: 0,
  verificationStatus: "VERIFIED",
  media: { gallery: [] },
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

test("company edit maps all seven fields without discarding multiline content", () => {
  const values = companyEditValues(company);
  assert.equal(Object.keys(values).length, 7);
  assert.equal(values.description, company.description);
  assert.equal(values.taxCode, "0012345678");
  assert.equal(isCompanyEditDirty(values, company), false);
  assert.deepEqual(validateCompanyEdit(values), {});
});

test("company edit trims outbound fields, clears website with null, and retains version zero", () => {
  const values = { ...companyEditValues(company), name: "  Tên mới  ", website: "   " };
  const update = buildCompanyEditUpdate(values, company);
  assert.equal(update.name, "Tên mới");
  assert.equal(update.website, null);
  assert.equal(update.expectedVersion, 0);
  assert.equal(update.taxCode, "0012345678");
  assert.equal(Object.keys(update).length, 8);
  assert.equal(values.name, "  Tên mới  ");
});

test("company edit version comes from the form snapshot, not a newer media response", () => {
  const baseline = { ...company, aggregateVersion: 4 };
  const mediaResponse = { ...company, aggregateVersion: 5 };
  const draft = { ...companyEditValues(baseline), description: "Bản nháp chưa lưu" };
  assert.equal(buildCompanyEditUpdate(draft, baseline).expectedVersion, 4);
  assert.equal(buildCompanyEditUpdate(draft, mediaResponse).expectedVersion, 5);
  assert.equal(draft.description, "Bản nháp chưa lưu");
});

for (const [field, minimum, maximum] of [
  ["name", 2, 160],
  ["description", 1, 10_000],
  ["industry", 1, 120],
  ["size", 1, 50],
  ["address", 1, 500],
  ["taxCode", 1, 32],
] as const) {
  test(`company edit enforces trimmed ${field} bounds and treats it as dirty`, () => {
    const initial = companyEditValues(company);
    assert.ok(validateCompanyEdit({ ...initial, [field]: " \n " })[field]);
    assert.ok(validateCompanyEdit({ ...initial, [field]: "x".repeat(maximum + 1) })[field]);
    assert.equal(validateCompanyEdit({ ...initial, [field]: "x".repeat(minimum) })[field], undefined);
    assert.equal(validateCompanyEdit({ ...initial, [field]: "x".repeat(maximum) })[field], undefined);
    assert.equal(isCompanyEditDirty({ ...initial, [field]: "Đổi giá trị" }, company), true);
  });
}

test("company edit accepts optional HTTP website and rejects invalid or overlong URLs", () => {
  const initial = companyEditValues(company);
  for (const website of ["", "https://example.vn/about", "http://example.vn"]) {
    assert.equal(validateCompanyEdit({ ...initial, website }).website, undefined);
  }
  for (const website of ["example.vn", "javascript:alert(1)", "ftp://example.vn", "https://example.vn/" + "a".repeat(2048)]) {
    assert.ok(validateCompanyEdit({ ...initial, website }).website);
  }
  assert.equal(isCompanyEditDirty({ ...initial, website: "" }, company), true);
});

test("company edit missing optional API profile values become empty form strings", () => {
  const values = companyEditValues({ ...company, description: undefined, industry: undefined, size: undefined, address: undefined, website: null });
  for (const field of ["description", "industry", "size", "address", "website"] as const) {
    assert.equal(values[field], "");
  }
});

test("company edit 409 compares every field, reloads once and retains the complete raw draft", async () => {
  const draft: CompanyEditValues = {
    name: "  Tên tôi nhập  ", taxCode: "0099", description: "Mô tả tôi nhập",
    industry: "Lĩnh vực mới", size: "200+", address: "Địa chỉ mới", website: "",
  };
  let reloads = 0;
  const snapshot = await prepareConflictSnapshot({
    error: new ApiClientError({ status: 409, code: "COMPANY_UPDATE_CONFLICT" }),
    localDraft: draft,
    localVersion: 0,
    reload: async () => { reloads += 1; return { ...company, aggregateVersion: 1 }; },
    serverVersion: (value) => value.aggregateVersion,
    fields: COMPANY_EDIT_CONFLICT_FIELDS,
  });
  assert.equal(reloads, 1);
  assert.equal(snapshot.localDraft, draft);
  assert.equal(snapshot.fields.length, 7);
  assert.equal(snapshot.fields.filter((field) => field.changed).length, 7);
  assert.equal(snapshot.serverVersion, 1);
  assert.equal(snapshot.localVersion, 0);
  assert.equal(buildCompanyEditUpdate(snapshot.localDraft, snapshot.server).expectedVersion, 1);
  assert.deepEqual(companyEditValues(snapshot.server), companyEditValues(company));
});
