import assert from "node:assert/strict";
import test from "node:test";
import { passwordError, validatePersonalFile, personalFileUploadError, landing, loginRoute, loginDestination } from "./person1Api";
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
test("upload configuration failures explain the recovery without exposing provider details", () => {
  for (const [status, payload] of [
    [400, { error: { message: "Upload preset not found: private-preset; key=private-key" } }],
    [400, { error: { message: "Invalid Signature private-signature for private-account" } }],
    [403, { error: { message: "Forbidden for private-key" } }],
  ] as const) {
    const error = personalFileUploadError(status, payload);
    assert.match(error.message, /chưa được cấu hình đầy đủ/);
    assert.doesNotMatch(error.message, /private-|Upload preset|Signature/);
  }
});
test("upload limits and transient failures suggest different recovery actions", () => {
  assert.match(personalFileUploadError(413, null).message, /chọn tệp nhỏ hơn/);
  assert.match(personalFileUploadError(429, {}).message, /thử tải tệp lại sau/);
  assert.match(personalFileUploadError(503, { error: "malformed" }).message, /thử tải tệp lại sau/);
  assert.match(personalFileUploadError(400, { error: { message: 123 } }).message, /Kiểm tra định dạng và dung lượng/);
});
test("roles have their own entry route", () => {
  assert.equal(landing("ADMIN"), "/admin");
  assert.equal(landing("CANDIDATE"), "/candidate/profile");
  assert.equal(landing("RECRUITER"), "/recruiter/jobs");
  assert.equal(loginRoute("ADMIN"), "/admin/login");
  assert.equal(loginRoute("RECRUITER"), "/recruiter/login");
  assert.equal(loginRoute("CANDIDATE"), "/login");
});
test("login return paths stay in their role portal and reject redirect tricks", () => {
  assert.equal(loginDestination("CANDIDATE", "/candidate/profile/cvs?tab=online"), "/candidate/profile/cvs?tab=online");
  assert.equal(loginDestination("RECRUITER", "/recruiter/jobs/new"), "/recruiter/jobs/new");
  assert.equal(loginDestination("ADMIN", "/admin"), "/admin");
  assert.equal(loginDestination("CANDIDATE", "/ai"), "/ai");
  for (const target of [null, "https://evil.example", "//evil.example", "/admin", "/recruiter/jobs", "/candidate/../admin", "/candidate/%2e%2e/admin", "/candidate/\\evil", "/candidate/%5cevil", "/candidate/%2fadmin", "/candidate/%252e%252e/admin", "/candidate/%ZZ"]) {
    assert.equal(loginDestination("CANDIDATE", target), "/candidate/profile");
  }
  assert.equal(loginDestination("ADMIN", "/candidate/profile"), "/admin");
  assert.equal(loginDestination("RECRUITER", "/recruiter/login"), "/recruiter/jobs");
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
