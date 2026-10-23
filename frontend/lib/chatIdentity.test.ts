import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationIdentity } from './chatIdentity';
import type { ChatConversation } from './chatApi';

const account = 'candidate', peer = 'recruiter';
const chat: ChatConversation = { id: 'chat', title: 'Chat với Nhà tuyển dụng', members: [account, peer], is_group: false, created_at: '', updated_at: '' };

test('direct chats show current company or candidate identity regardless of the old shared title', () => {
  const company = { ...chat, counterpart: { user_id: peer, kind: 'COMPANY' as const, display_name: 'An Việt Digital', avatar_url: 'https://example.test/logo.png' } };
  assert.equal(conversationIdentity(company, account).name, 'An Việt Digital');
  assert.equal(conversationIdentity(company, account).description, 'Công ty tuyển dụng');
  assert.equal(conversationIdentity(company, account).imageUrl, 'https://example.test/logo.png');
  const candidate = { ...chat, counterpart: { user_id: account, kind: 'CANDIDATE' as const, display_name: 'Nguyễn Minh Anh' } };
  assert.equal(conversationIdentity(candidate, peer).name, 'Nguyễn Minh Anh');
  assert.equal(conversationIdentity(candidate, peer).description, 'Ứng viên');
});

test('group titles remain intact and untrusted/self counterpart identities cannot overwrite a conversation', () => {
  const injected = { ...chat, counterpart: { user_id: 'outsider', kind: 'COMPANY' as const, display_name: 'Unrelated private identity' } };
  assert.equal(conversationIdentity(injected, account).name, 'Cuộc trò chuyện');
  assert.equal(conversationIdentity({ ...injected, counterpart: { ...injected.counterpart, user_id: account } }, account).name, 'Cuộc trò chuyện');
  assert.equal(conversationIdentity({ ...injected, is_group: true, title: 'Nhóm dự án' }, account).name, 'Nhóm dự án');
});

test('missing identity preserves useful legacy names and rejects unsafe image protocols', () => {
  assert.equal(conversationIdentity({ ...chat, title: 'Chat với Nguyễn Minh Anh' }, peer).name, 'Nguyễn Minh Anh');
  assert.equal(conversationIdentity({ ...chat, avatar_url: 'javascript:alert(1)' }, account).imageUrl, null);
  assert.equal(conversationIdentity({ ...chat, avatar_url: 'data:text/html,private' }, account).imageUrl, null);
});
