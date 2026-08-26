'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FileOwnerType,
  MediaType,
  StorageDeliveryType,
  StorageResourceType,
} = require('@prisma/client');
const { SystemRole } = require('../dist/common/auth/system-role.enum');
const {
  MEDIA_POLICIES,
  assertInternalProducerAllowed,
  assertPublicUploadAllowed,
  matchesMagicBytes,
  validateOriginalFilename,
} = require('../dist/media/media-policy');

test('media v1 policy defines exactly six controlled purposes', () => {
  assert.deepEqual(
    Object.keys(MEDIA_POLICIES).sort(),
    Object.values(MediaType).sort(),
  );
  assert.equal(MEDIA_POLICIES.CV.maxBytes, 5 * 1024 * 1024);
  assert.equal(
    MEDIA_POLICIES.CV.deliveryType,
    StorageDeliveryType.AUTHENTICATED,
  );
  assert.equal(
    MEDIA_POLICIES.CV.resourceType,
    StorageResourceType.RAW,
  );
  assert.equal(
    MEDIA_POLICIES.COMPANY_VIDEO.maxBytes,
    50 * 1024 * 1024,
  );
  assert.equal(
    MEDIA_POLICIES.CHAT_ATTACHMENT.maxBytes,
    10 * 1024 * 1024,
  );
});

test('public and internal upload policy is fail-closed', () => {
  assert.doesNotThrow(() =>
    assertPublicUploadAllowed(SystemRole.CANDIDATE, MediaType.CV),
  );
  assert.throws(() =>
    assertPublicUploadAllowed(SystemRole.RECRUITER, MediaType.CV),
  );
  assert.throws(() =>
    assertPublicUploadAllowed(
      SystemRole.CANDIDATE,
      MediaType.COMPANY_IMAGE,
    ),
  );
  assert.doesNotThrow(() =>
    assertInternalProducerAllowed(
      'company-service',
      MediaType.COMPANY_IMAGE,
      FileOwnerType.COMPANY,
    ),
  );
  assert.throws(() =>
    assertInternalProducerAllowed(
      'profile-service',
      MediaType.COMPANY_IMAGE,
      FileOwnerType.COMPANY,
    ),
  );
});

test('filename validation canonicalizes jpeg and rejects paths or executables', () => {
  assert.deepEqual(
    validateOriginalFilename(
      ' portrait.JPEG ',
      MEDIA_POLICIES.AVATAR,
    ),
    { originalFilename: 'portrait.JPEG', format: 'jpg' },
  );

  assert.deepEqual(
    validateOriginalFilename(
      'cafe\u0301.png',
      MEDIA_POLICIES.AVATAR,
    ),
    { originalFilename: 'café.png', format: 'png' },
  );
  assert.throws(() =>
    validateOriginalFilename(
      'report\u202efdp.pdf',
      MEDIA_POLICIES.CV,
    ),
  );
  assert.throws(() =>
    validateOriginalFilename('../avatar.png', MEDIA_POLICIES.AVATAR),
  );
  assert.throws(() =>
    validateOriginalFilename('payload.exe', MEDIA_POLICIES.CV),
  );
});

test('magic-byte checks reject extension-only masquerading', () => {
  assert.equal(
    matchesMagicBytes('pdf', Buffer.from('%PDF-1.7\n')),
    true,
  );
  assert.equal(
    matchesMagicBytes('pdf', Buffer.from('MZ executable')),
    false,
  );

  assert.equal(
    matchesMagicBytes('pdf', Buffer.from('prefix %PDF-1.7')),
    false,
  );
  assert.equal(
    matchesMagicBytes(
      'png',
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
      ]),
    ),
    true,
  );
});
