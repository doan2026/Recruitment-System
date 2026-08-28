'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RequestMethod } = require('@nestjs/common');
const {
  METHOD_METADATA,
  PATH_METADATA,
} = require('@nestjs/common/constants');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  CvVersionPreconditionDto,
  RenameUploadedCvDto,
} = require('../dist/profile/dto/profile-media-input.dto');
const {
  ProfileMediaController,
} = require('../dist/profile/profile-media.controller');

const USER_ID = '979ce958-aac2-4a75-9fd2-82e79e383733';
const CV_ID = '72dbbe39-d98e-42c6-bdb1-745a024c0896';

const validationErrors = (Type, input) =>
  validate(plainToInstance(Type, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

test('CV lifecycle DTOs enforce a trimmed title and a bounded integer version', async () => {
  const rename = plainToInstance(RenameUploadedCvDto, {
    title: '  Backend CV  ',
    expectedAggregateVersion: 7,
  });
  assert.deepEqual(await validate(rename), []);
  assert.equal(rename.title, 'Backend CV');

  const validPrecondition = await validationErrors(
    CvVersionPreconditionDto,
    { expectedAggregateVersion: 1 },
  );
  assert.deepEqual(validPrecondition, []);

  for (const expectedAggregateVersion of [
    0,
    1.5,
    2_147_483_648,
    '1',
  ]) {
    const errors = await validationErrors(CvVersionPreconditionDto, {
      expectedAggregateVersion,
    });
    assert.notEqual(errors.length, 0, String(expectedAggregateVersion));
  }

  for (const title of ['', ' '.repeat(4), 'x'.repeat(161), 42]) {
    const errors = await validationErrors(RenameUploadedCvDto, {
      title,
      expectedAggregateVersion: 1,
    });
    assert.notEqual(errors.length, 0, String(title));
  }

  const extraFieldErrors = await validationErrors(
    CvVersionPreconditionDto,
    { expectedAggregateVersion: 1, ignored: true },
  );
  assert.notEqual(extraFieldErrors.length, 0);
});

test('CV lifecycle routes expose canonical plural paths and singular aliases', () => {
  const prototype = ProfileMediaController.prototype;
  const expectations = [
    ['renameCv', RequestMethod.PATCH, ['cvs/:id', 'cv/:id']],
    [
      'setDefaultCv',
      RequestMethod.PATCH,
      ['cvs/:id/default', 'cv/:id/default'],
    ],
    ['deleteCv', RequestMethod.DELETE, ['cvs/:id', 'cv/:id']],
  ];

  for (const [methodName, requestMethod, paths] of expectations) {
    const handler = prototype[methodName];
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), requestMethod);
    assert.deepEqual(Reflect.getMetadata(PATH_METADATA, handler), paths);
  }
});

test('CV lifecycle controller delegates the authenticated candidate and version precondition', async () => {
  const calls = [];
  const renamed = { id: CV_ID, title: 'Backend CV' };
  const selected = { id: CV_ID, isDefault: true };
  const deleted = {
    id: CV_ID,
    userId: USER_ID,
    deletionMode: 'SOFT',
    isDeleted: true,
    deletedAt: '2026-08-27T10:00:00.000Z',
    replacementDefaultCvId: null,
    aggregateVersion: 10,
    cleanupPending: false,
  };
  const media = {
    renameUploadedCv: async (...args) => {
      calls.push(['rename', ...args]);
      return renamed;
    },
    setDefaultUploadedCv: async (...args) => {
      calls.push(['default', ...args]);
      return selected;
    },
    deleteUploadedCv: async (...args) => {
      calls.push(['delete', ...args]);
      return deleted;
    },
  };
  const controller = new ProfileMediaController(media);
  const statuses = [];
  const response = {
    status: (status) => {
      statuses.push(status);
      return response;
    },
  };
  const user = { id: USER_ID };
  const renameDto = {
    title: 'Backend CV',
    expectedAggregateVersion: 7,
  };

  assert.equal(await controller.renameCv(user, CV_ID, renameDto), renamed);
  assert.equal(
    await controller.setDefaultCv(user, CV_ID, {
      expectedAggregateVersion: 8,
    }),
    selected,
  );
  assert.equal(
    await controller.deleteCv(user, CV_ID, {
      expectedAggregateVersion: 9,
    }, response),
    deleted,
  );
  assert.deepEqual(calls, [
    ['rename', USER_ID, CV_ID, renameDto],
    ['default', USER_ID, CV_ID, 8],
    ['delete', USER_ID, CV_ID, 9],
  ]);
  assert.deepEqual(statuses, [200]);
});

test('CV delete route returns 202 only for a durable PENDING workflow', async () => {
  const pending = {
    id: CV_ID,
    userId: USER_ID,
    deletionMode: 'PENDING',
    isDeleted: true,
    deletedAt: '2026-08-27T10:00:00.000Z',
    replacementDefaultCvId: null,
    aggregateVersion: 2,
    cleanupPending: false,
  };
  const controller = new ProfileMediaController({
    deleteUploadedCv: async () => pending,
  });
  let status;
  const response = {
    status: (value) => {
      status = value;
      return response;
    },
  };
  assert.equal(
    await controller.deleteCv(
      { id: USER_ID },
      CV_ID,
      { expectedAggregateVersion: 1 },
      response,
    ),
    pending,
  );
  assert.equal(status, 202);
});
