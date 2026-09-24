import assert from "node:assert/strict";
import test from "node:test";
import { passwordError, validatePersonalFile, landing } from "./person1Api";
import { validateBuilder, contentFromProfile } from "./cvPdf";
import { clearApiSession, requestApi, setApiSession } from "./apiClientCore";
test("registration password validates Unicode letters and bcrypt byte boundary", () => {
  assert.equal(passwordError("MậtKhẩu123"), null);
  assert.ok(passwordError("abcdefgh"));
  assert.ok(passwordError("12345678"));
  assert.ok(passwordError("ậ".repeat(24) + "1"));
  assert.equal(passwordError("a".repeat(71) + "1"), null);
});
test("personal uploads reject extension spoof, empty files and size overflow", () => {
  assert.doesNotThrow(() =>
    validatePersonalFile({ name: "cv.PDF", size: 5 * 1024 * 1024 }, "CV"),
  );
  for (const file of [
    { name: "cv.exe", size: 100 },
    { name: "cv.pdf.exe", size: 100 },
    { name: "cv.pdf", size: 0 },
    { name: "cv.pdf", size: 5 * 1024 * 1024 + 1 },
  ])
    assert.throws(() => validatePersonalFile(file, "CV"));
  assert.throws(() =>
    validatePersonalFile({ name: "avatar.pdf", size: 100 }, "AVATAR"),
  );
});
test("builder rejects foreign shapes and oversized content", () => {
  assert.throws(() => validateBuilder({ sections: "unsafe" }));
  assert.throws(() =>
    validateBuilder({
      fullName: "A",
      headline: "",
      summary: "x".repeat(40001),
      contact: "",
      sections: [],
    }),
  );
  assert.deepEqual(
    validateBuilder({
      fullName: "Nguyễn An",
      headline: "",
      summary: "",
      contact: "",
      sections: [],
    }).sections,
    [],
  );
});
test("roles have their own entry route", () => {
  assert.equal(landing("ADMIN"), "/admin");
  assert.equal(landing("CANDIDATE"), "/candidate/profile");
  assert.equal(landing("RECRUITER"), "/recruiter/jobs");
});
test("binary export preserves bearer authentication and no-store", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080";
  setApiSession({ token: "test-token", accountId: "candidate" });
  let seen: RequestInit | undefined;
  const response = await requestApi<Blob>("/admin/stats/export", {
    privateData: true,
    responseType: "blob",
    fetcher: async (_url, init) => {
      seen = init;
      return new Response("date,metric,value", {
        headers: { "content-type": "text/csv" },
      });
    },
  });
  assert.equal(await response.data.text(), "date,metric,value");
  assert.equal(
    new Headers(seen?.headers).get("authorization"),
    "Bearer test-token",
  );
  assert.equal(seen?.cache, "no-store");
  clearApiSession();
});
test("binary response from a previous session is discarded", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080";
  setApiSession({ token: "old", accountId: "old" });
  await assert.rejects(
    () =>
      requestApi<Blob>("/admin/stats/export", {
        privateData: true,
        responseType: "blob",
        fetcher: async () => {
          setApiSession({ token: "new", accountId: "new" });
          return new Response("private report");
        },
      }),
    /REQUEST_CANCELLED|hủy|huỷ/i,
  );
  clearApiSession();
});
