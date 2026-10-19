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

import { schedulingRequestIdentity } from "./interviewApi";
import { listChatMessages, mergeConversationMessages, parseCallMessage, sendChatMessage, type ChatMessage } from "./chatApi";
import { mergeNotifications, notificationDestination } from "./notificationState";

test("a changed interview draft gets a new request identity while an unchanged retry retains its id", () => {
  const payload = { applicationId: "application", roundNumber: 1, scheduledStart: "2027-01-15T09:30:00+07:00", timeZone: "Asia/Ho_Chi_Minh" as const, durationMinutes: 45, mode: "OFFLINE" as const, location: "Room A", notes: null };
  const first = schedulingRequestIdentity(null, payload, () => "request-one");
  assert.equal(schedulingRequestIdentity(first, { ...payload }, () => "unused"), first);
  assert.equal(schedulingRequestIdentity(first, { ...payload, location: "Room B" }, () => "request-two").id, "request-two");
});

test("chat messages remain conversation-scoped and deduplicate a repeated HTTP/socket delivery", () => {
  const message: ChatMessage = { id: "one", conversation_id: "thread-a", sender_id: "sender", content: "Hello", created_at: "2026-10-01T08:00:00Z", client_message_id: "client-one" };
  assert.deepEqual(mergeConversationMessages("thread-a", [message], [{ ...message, conversation_id: "thread-b", id: "other" }]), [message]);
  assert.equal(mergeConversationMessages("thread-a", [message], [{ ...message }]).length, 1);
  assert.equal(mergeConversationMessages("thread-a", [message], [{ ...message, id: "canonical" }])[0].id, "canonical");
  assert.equal(mergeConversationMessages("thread-a", [{ ...message, client_message_id: undefined }], [{ ...message, id: "two", client_message_id: undefined }]).length, 2);
});

test("chat older-page requests use the Go cursor field and failed sends never automatically duplicate", async () => {
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.API_INTERNAL_BASE_URL;
  process.env.API_INTERNAL_BASE_URL = "http://gateway.test";
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") {
      writes++;
      assert.deepEqual(JSON.parse(String(options.body)), { content: "Keep my draft", client_message_id: "retry-id" });
      return new Response(JSON.stringify({ code: "UNAVAILABLE" }), { status: 503 });
    }
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("cursor"), "2026-10-01T08:00:00Z");
    assert.equal(parsed.searchParams.has("before"), false);
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await listChatMessages("thread-a", "2026-10-01T08:00:00Z");
    await assert.rejects(sendChatMessage("thread-a", "Keep my draft", "retry-id"));
    assert.equal(writes, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.API_INTERNAL_BASE_URL;
    else process.env.API_INTERNAL_BASE_URL = previousBase;
  }
});

test("notification upserts replace their existing row and link to the account's application flow", () => {
  const notification = { id: "notice", type: "application", title: "Application", body: "Earlier", is_read: false, created_at: "2026-10-01T08:00:00Z", metadata: { application_id: "application-one" } };
  const result = mergeNotifications([notification], [{ ...notification, body: "Updated" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].body, "Updated");
  assert.equal(notificationDestination(notification, "CANDIDATE"), "/candidate/applications/application-one");
  assert.equal(notificationDestination(notification, "RECRUITER"), "/recruiter/applications/application-one");
  assert.equal(notificationDestination(notification, "ADMIN"), null);
  const interviewNotice = { ...notification, type: "INTERVIEW_SCHEDULED", metadata: { application_id: "application-one", interview_id: "interview-one" } };
  assert.equal(notificationDestination(interviewNotice, "CANDIDATE"), "/candidate/interviews");
  assert.equal(notificationDestination(interviewNotice, "RECRUITER"), "/recruiter/applications/application-one");
});

test("only exact call markers with valid IDs become call actions", () => {
  assert.deepEqual(parseCallMessage("[call_ended] 1795C0DE-7908-4AB5-9BED-4C4F1CF9C211"), { action: "ENDED", callId: "1795c0de-7908-4ab5-9bed-4c4f1cf9c211" });
  assert.equal(parseCallMessage("[CALL_STARTED] ../../elsewhere"), null);
  assert.equal(parseCallMessage("[CALL_STARTED] 1795c0de-7908-4ab5-9bed-4c4f1cf9c211 extra"), null);
  assert.deepEqual(parseCallMessage("[CALL_ENDED] 1795c0de-7908-4ab5-9bed-4c4f1cf9c211"), { action: "ENDED", callId: "1795c0de-7908-4ab5-9bed-4c4f1cf9c211" });
});
