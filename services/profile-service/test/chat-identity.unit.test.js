'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateSync } = require('class-validator');
const { InternalAuthService } = require('../dist/common/auth/internal-auth.service');
const { ChatIdentityService } = require('../dist/profile/chat-identity.service');
const { ChatIdentityRequestDto } = require('../dist/profile/dto/chat-identity.dto');
const id = '1795c0de-7908-4ab5-9bed-4c4f1cf9c211';
const keys = { INTERNAL_API_KEY_APPLICATION: 'application-profile-contract-key-000000000001', INTERNAL_API_KEY_JOB_SEARCH: 'job-search-profile-contract-key-0000000000001', INTERNAL_API_KEY_CHAT: 'chat-profile-contract-key-000000000000000001' };

test('Chat credential cannot read CVs or act as another internal caller', () => {
  const service = new InternalAuthService({ get: name => keys[name] });
  service.assertConfiguration();
  assert.deepEqual(service.authenticate(keys.INTERNAL_API_KEY_CHAT, 'chat-service', ['chat-service']), { service: 'chat-service' });
  assert.throws(() => service.authenticate(keys.INTERNAL_API_KEY_CHAT, 'chat-service'), error => error.getStatus() === 401);
  assert.throws(() => service.authenticate(keys.INTERNAL_API_KEY_APPLICATION, 'application-service', ['chat-service']), error => error.getStatus() === 401);
  const reused = new InternalAuthService({ get: name => name === 'INTERNAL_API_KEY_CHAT' ? keys.INTERNAL_API_KEY_APPLICATION : keys[name] });
  assert.throws(() => reused.assertConfiguration(), error => error.getStatus() === 503);
});

test('Chat display lookup exposes only names and avatars for bounded explicit IDs', async () => {
  const service = new ChatIdentityService({ profile: { findMany: async query => {
    assert.deepEqual(query.where, { userId: { in: [id] } });
    assert.deepEqual(query.select, { userId: true, fullName: true, avatarUrl: true });
    return [{ userId: id, fullName: 'Nguyễn Minh Anh', avatarUrl: 'https://example.test/a.png', phone: 'private', summary: 'private' }];
  } } });
  assert.deepEqual(await service.resolve([id]), [{ userId: id, name: 'Nguyễn Minh Anh', avatarUrl: 'https://example.test/a.png' }]);
  for (const userIds of [[], [id, id], ['invalid'], Array(101).fill(id)]) assert(validateSync(Object.assign(new ChatIdentityRequestDto(), { userIds })).length > 0);
  assert.equal(validateSync(Object.assign(new ChatIdentityRequestDto(), { userIds: [id] })).length, 0);
});
