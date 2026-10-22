import { expect, test, type Page, type Route } from "@playwright/test";
import { scopedDestination } from "../../lib/portalRoutes";

const api = "http://127.0.0.1:4173/api";
const userId = "1795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const firstId = "2795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const secondId = "3795c0de-7908-4ab5-9bed-4c4f1cf9c211";
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(status < 400 ? { data, meta: null } : data) });
const message = (id: string, conversationId = firstId, content = id) => ({ id, conversation_id: conversationId, sender_id: secondId, content, created_at: "2026-10-01T08:00:00Z" });

async function session(page: Page, destination: string) {
  await page.addInitScript(() => {
    class TestEventSource extends EventTarget {
      constructor(_url: string) { super(); (window as any).__notificationStream = this; }
      close() {}
    }
    const NativeWebSocket = window.WebSocket;
    class TestWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(url: string | URL) {
        super();
        if (!String(url).includes("/api/chat/ws/chat")) return new NativeWebSocket(url) as unknown as TestWebSocket;
        (window as any).__chatSocket = this;
      }
      close() {}
    }
    (window as any).EventSource = TestEventSource;
    (window as any).WebSocket = TestWebSocket;
  });
  await page.route(api + "/auth/me", route => reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/refresh", route => reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/profile/" + userId, route => reply(route, { fullName: "Communication Fixture" }));
  await page.route(api + "/notifications**", route => reply(route, route.request().url().includes("unread-count") ? { unread_count: 0 } : []));
  await page.route(api + "/auth-cookie/login", route => reply(route, { user: { id: userId, email: "chat@example.test", role: "CANDIDATE" } }));
  await page.goto("/login?returnTo=" + encodeURIComponent(destination));
  await page.getByLabel("Email", { exact: true }).fill("chat@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("ChatFixturePassword123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const target = new URL(destination, "http://127.0.0.1:4173");
  await expect(page).toHaveURL("http://127.0.0.1:4173" + scopedDestination("CANDIDATE", target.pathname) + target.search);
}

async function conversations(page: Page) {
  await page.route(api + "/chat/chats", route => reply(route, [
    { id: firstId, title: "Hội thoại A", members: [userId, secondId], updated_at: "2026-10-01T08:00:00Z" },
    { id: secondId, title: "Hội thoại B", members: [userId, firstId], updated_at: "2026-10-01T08:00:00Z" },
  ]));
}

test("socket messages remain in their conversation and repeated deliveries render once", async ({ page }) => {
  await conversations(page);
  await page.route(api + "/chat/chats/*/messages**", route => reply(route, [message("stored-message")]));
  await session(page, "/messages?chat=" + firstId);
  await expect(page.getByText("stored-message", { exact: true })).toBeVisible();
  await page.evaluate(({ own, foreign }) => {
    const socket = (window as any).__chatSocket;
    for (const msg of [foreign, own, own]) socket.onmessage(new MessageEvent("message", { data: JSON.stringify({ type: "new_message", message: msg }) }));
  }, { own: message("new-message"), foreign: message("private-other-thread", secondId) });
  await expect(page.getByText("new-message", { exact: true })).toHaveCount(1);
  await expect(page.getByText("private-other-thread", { exact: true })).toHaveCount(0);
});

test("failed chat send keeps draft and retries its client message identity", async ({ page }) => {
  await conversations(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route(api + "/chat/chats/*/messages**", route => {
    if (route.request().method() !== "POST") return reply(route, []);
    bodies.push(route.request().postDataJSON());
    return bodies.length === 1 ? reply(route, { code: "UNAVAILABLE" }, 503)
      : reply(route, { ...message("saved", firstId, "Giữ nội dung này"), sender_id: userId, client_message_id: bodies[0].client_message_id });
  });
  await session(page, "/messages?chat=" + firstId);
  await page.getByLabel("Nội dung tin nhắn", { exact: true }).fill("Giữ nội dung này");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.locator("form p[role=alert]")).toContainText("Nội dung vẫn được giữ");
  await expect(page.getByLabel("Nội dung tin nhắn", { exact: true })).toHaveValue("Giữ nội dung này");
  expect(bodies).toHaveLength(1);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByLabel("Nội dung tin nhắn", { exact: true })).toHaveValue("");
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.getByText("Giữ nội dung này", { exact: true })).toHaveCount(1);
});

test("older chat history sends cursor and deduplicates overlap", async ({ page }) => {
  await conversations(page);
  const urls: string[] = [];
  const current = Array.from({ length: 20 }, (_, index) => ({ ...message("recent-" + index), created_at: `2026-10-01T08:${String(index).padStart(2, "0")}:00Z` }));
  await page.route(api + "/chat/chats/*/messages**", route => {
    urls.push(route.request().url());
    return reply(route, new URL(route.request().url()).searchParams.has("cursor") ? [message("older"), current[0]] : current);
  });
  await session(page, "/messages?chat=" + firstId);
  await page.getByRole("button", { name: "Tải tin nhắn cũ" }).click();
  await expect(page.getByText("older", { exact: true })).toBeVisible();
  await expect(page.getByText("recent-0", { exact: true })).toHaveCount(1);
  expect(urls.some(url => new URL(url).searchParams.get("cursor") === current[0].created_at)).toBe(true);
  expect(urls.some(url => new URL(url).searchParams.has("before"))).toBe(false);
});

test("notification SSE upserts replace a row and retain keyboard read actions", async ({ page }) => {
  await session(page, "/notifications");
  await expect(page.getByText("Chưa có thông báo", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const stream = (window as any).__notificationStream;
    const notice = { id: "notice-1", title: "Tin nhắn mới", type: "new_message", body: "Nội dung cũ", is_read: false, created_at: "2026-10-01T08:00:00Z" };
    for (const update of [notice, { ...notice, body: "Nội dung mới" }]) stream.dispatchEvent(new MessageEvent("notification", { data: JSON.stringify(update) }));
  });
  await expect(page.getByText("Nội dung mới", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Nội dung cũ", { exact: true })).toHaveCount(0);
  const mark = page.getByRole("button", { name: "Đánh dấu đã đọc", exact: true });
  await expect(mark).toBeVisible();
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(mark).toHaveCount(0);
});

test("communication routes show a login recovery instead of a blank page", async ({ page }) => {
  await page.route(api + "/auth/me", route => reply(route, { code: "AUTH_INVALID" }, 401));
  await page.route(api + "/auth-cookie/refresh", route => reply(route, { code: "AUTH_INVALID" }, 401));
  for (const path of ["/messages", "/notifications", `/interviews/${firstId}/room`]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  }
});

test("a first socket message discovers a new conversation without mixing its messages into the selected thread", async ({ page }) => {
  const list = [{ id: firstId, title: "Hội thoại A", members: [userId, secondId], updated_at: "2026-10-01T08:00:00Z" }];
  await page.route(api + "/chat/chats", route => reply(route, list));
  await page.route(api + "/chat/chats/*/messages**", route => {
    const conversationId = route.request().url().includes(secondId) ? secondId : firstId;
    return reply(route, [message(conversationId === firstId ? "Tin nhắn A" : "Tin nhắn mới từ B", conversationId)]);
  });
  await session(page, "/messages?chat=" + firstId);
  await expect(page.getByText("Tin nhắn A", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Hội thoại B/ })).toHaveCount(0);
  list.push({ id: secondId, title: "Hội thoại B", members: [userId, firstId], updated_at: "2026-10-01T08:01:00Z" });
  await page.evaluate(incoming => {
    (window as any).__chatSocket.onmessage(new MessageEvent("message", { data: JSON.stringify({ type: "new_message", message: incoming }) }));
  }, message("new-thread-message", secondId, "Tin nhắn mới từ B"));
  await expect(page.getByRole("button", { name: /Hội thoại B/ })).toBeVisible();
  await expect(page.getByText("Tin nhắn mới từ B", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Hội thoại B/ }).click();
  await expect(page.getByText("Tin nhắn mới từ B", { exact: true })).toBeVisible();
  await expect(page.getByText("Tin nhắn A", { exact: true })).toHaveCount(0);
});

test("Candidate interview notifications open the calendar even when the event includes an application identity", async ({ page }) => {
  await session(page, "/notifications");
  await expect(page.getByText("Chưa có thông báo", { exact: true })).toBeVisible();
  await page.evaluate(applicationId => {
    const notification = { id: "interview-notice", title: "Đã lên lịch phỏng vấn", type: "INTERVIEW_SCHEDULED", body: "Xem thời gian và địa điểm phỏng vấn", is_read: false, created_at: "2026-10-01T08:00:00Z", metadata: { application_id: applicationId, interview_id: "interview-one" } };
    (window as any).__notificationStream.dispatchEvent(new MessageEvent("notification", { data: JSON.stringify(notification) }));
  }, firstId);
  await expect(page.getByRole("link", { name: "Xem chi tiết", exact: true })).toHaveAttribute("href", "/candidate/interviews");
});

test("an inbox refresh cannot overwrite newer SSE content or a successful read action", async ({ page }) => {
  await session(page, "/notifications");
  await expect(page.getByText("Chưa có thông báo", { exact: true })).toBeVisible();
  const original = { id: "refresh-notice", title: "Hồ sơ của bạn", type: "application", body: "Nội dung trước khi tải lại", is_read: false, created_at: "2026-10-01T08:00:00Z" };
  await page.evaluate(notification => {
    (window as any).__notificationStream.dispatchEvent(new MessageEvent("notification", { data: JSON.stringify(notification) }));
  }, original);
  await expect(page.getByText(original.body, { exact: true })).toBeVisible();
  let releaseRefresh: (() => void) | undefined;
  const release = new Promise<void>(resolve => { releaseRefresh = resolve; });
  let refreshStarted = false;
  let refreshFinished = false;
  await page.route(api + "/notifications", async route => {
    refreshStarted = true;
    await release;
    await reply(route, [original]);
    refreshFinished = true;
  });
  await page.getByRole("button", { name: "Tải lại thông báo", exact: true }).click();
  await expect.poll(() => refreshStarted).toBe(true);
  const updated = { ...original, body: "Nội dung SSE mới hơn", created_at: "2026-10-01T08:01:00Z" };
  const added = { ...original, id: "arrived-during-refresh", title: "Lịch mới", body: "Thông báo nhận trong lúc tải lại" };
  await page.evaluate(notifications => {
    for (const notification of notifications) (window as any).__notificationStream.dispatchEvent(new MessageEvent("notification", { data: JSON.stringify(notification) }));
  }, [updated, added]);
  const target = page.locator("article").filter({ hasText: updated.body });
  await target.getByRole("button", { name: "Đánh dấu đã đọc", exact: true }).click();
  await expect(target.getByText(/Đã đọc/)).toBeVisible();
  releaseRefresh?.();
  await expect.poll(() => refreshFinished).toBe(true);
  await expect(page.getByRole("button", { name: "Tải lại thông báo", exact: true })).toBeEnabled();
  await expect(page.getByText(updated.body, { exact: true })).toBeVisible();
  await expect(page.getByText(original.body, { exact: true })).toHaveCount(0);
  await expect(page.getByText(added.body, { exact: true })).toBeVisible();
  await expect(target.getByRole("button", { name: "Đánh dấu đã đọc", exact: true })).toHaveCount(0);
});

test("chat call markers only dismiss an invitation after Video confirms the call is absent from a complete active list", async ({ page }) => {
  await session(page, "/notifications");
  await expect(page.getByText("Chưa có thông báo", { exact: true })).toBeVisible();
  const callId = "4795c0de-7908-4ab5-9bed-4c4f1cf9c211";
  let activeCalls = [{ id: callId }];
  let checks = 0;
  let unavailable = false;
  await page.route(api + "/calls", async route => {
    await reply(route, unavailable ? { code: "UNAVAILABLE" } : activeCalls, unavailable ? 503 : 200);
    checks++;
  });
  await page.evaluate(({ callId, conversationId }) => {
    const notification = { id: "incoming-call", type: "video_call", title: "Lời mời gọi video", body: "Tham gia cuộc gọi", is_read: false, created_at: "2026-10-01T08:00:00Z", metadata: { call_id: callId, conversation_id: conversationId } };
    (window as any).__notificationStream.dispatchEvent(new MessageEvent("notification", { data: JSON.stringify(notification) }));
  }, { callId, conversationId: firstId });
  const invitation = page.getByRole("region", { name: "Cuộc gọi đến", exact: true });
  await expect(invitation).toBeVisible();
  const emitEnded = () => page.evaluate(callId => {
    const notification = { id: "raw-call-marker", type: "new_message", title: "Tin nhắn mới", body: `[CALL_ENDED] ${callId.toUpperCase()}`, is_read: false, created_at: "2026-10-01T08:01:00Z" };
    (window as any).__notificationStream.dispatchEvent(new MessageEvent("notification", { data: JSON.stringify(notification) }));
  }, callId);
  await emitEnded();
  await expect.poll(() => checks).toBe(1);
  await expect(invitation).toBeVisible();
  const emitSocketSignal = () => page.evaluate(callId => {
    window.dispatchEvent(new CustomEvent("video_call_signal", { detail: { callId, action: "ENDED" } }));
  }, callId);
  activeCalls = Array.from({ length: 50 }, (_, index) => ({ id: `other-call-${index}` }));
  await emitSocketSignal();
  await expect.poll(() => checks).toBe(2);
  await expect(invitation).toBeVisible();
  unavailable = true;
  await emitSocketSignal();
  await expect.poll(() => checks).toBe(3);
  await expect(invitation).toBeVisible();
  unavailable = false;
  activeCalls = [];
  await emitEnded();
  await expect.poll(() => checks).toBe(4);
  await expect(invitation).toHaveCount(0);
});
