import assert from "node:assert/strict";
import test from "node:test";
import { interviewStartGmt7, scheduleInterview } from "./interviewApi";

test("interview local time preserves GMT+7 regardless of browser or host timezone", () => {
  assert.equal(interviewStartGmt7("2027-01-15T09:30"), "2027-01-15T09:30:00+07:00");
  assert.equal(new Date(interviewStartGmt7("2027-01-15T00:30")).toISOString(), "2027-01-14T17:30:00.000Z");
  for (const invalid of ["", "2027-02-30T09:00", "2027-01-15T25:00", "2027-01-15T09:00Z"]) {
    assert.throws(() => interviewStartGmt7(invalid));
  }
});

test("an ambiguous scheduling failure sends one mutation with its stable request identity", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://gateway.test";
  const previousFetch = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (_url, options) => {
    writes++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.requestId, "1795c0de-7908-4ab5-9bed-4c4f1cf9c211");
    assert.equal(body.scheduledStart, "2027-01-15T09:30:00+07:00");
    return new Response(JSON.stringify({ code: "INTERVIEW_UNAVAILABLE" }), { status: 503 });
  };
  try {
    await assert.rejects(scheduleInterview({
      applicationId: "2795c0de-7908-4ab5-9bed-4c4f1cf9c211", requestId: "1795c0de-7908-4ab5-9bed-4c4f1cf9c211",
      roundNumber: 1, scheduledStart: "2027-01-15T09:30:00+07:00", timeZone: "Asia/Ho_Chi_Minh",
      durationMinutes: 45, mode: "OFFLINE", location: "Office", notes: null,
    }));
    assert.equal(writes, 1);
  } finally { globalThis.fetch = previousFetch; delete process.env.NEXT_PUBLIC_API_BASE_URL; }
});
