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
  CvBuilderController,
} = require('../dist/profile/cv-builder.controller');
const {
  CreateOnlineCvDto,
  CreateOnlineCvRevisionDto,
} = require('../dist/profile/dto/profile-media-input.dto');
const {
  MAX_CV_BUILDER_CONTENT_BYTES,
} = require('../dist/profile/dto/cv-builder-content.decorator');

const USER_ID = '979ce958-aac2-4a75-9fd2-82e79e383733';
const CV_ID = '72dbbe39-d98e-42c6-bdb1-745a024c0896';
const FILE_ID = '82dbbe39-d98e-42c6-bdb1-745a024c0896';

const validationErrors = (Type, input) =>
  validate(plainToInstance(Type, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const snapshot = (overrides = {}) => ({
  title: '  Backend CV  ',
  templateId: ' clean-v1 ',
  contentSchemaVersion: 1,
  contentJson: {
    basics: { fullName: 'Nguyễn Văn An' },
    sections: ['experience', 'skills'],
  },
  fileId: FILE_ID,
  ...overrides,
});

test('CV Builder DTO accepts only bounded version-1 JSON snapshots', async () => {
  const input = plainToInstance(CreateOnlineCvDto, snapshot());
  assert.deepEqual(await validate(input), []);
  assert.equal(input.title, 'Backend CV');
  assert.equal(input.templateId, 'clean-v1');

  const invalidCases = [
    snapshot({ contentSchemaVersion: 2 }),
    snapshot({ contentSchemaVersion: '1' }),
    snapshot({ contentJson: [] }),
    snapshot({ contentJson: null }),
    snapshot({ templateId: '../unsafe-template' }),
    snapshot({ ignored: true }),
  ];
  for (const candidate of invalidCases) {
    const errors = await validationErrors(CreateOnlineCvDto, candidate);
    assert.notEqual(errors.length, 0, JSON.stringify(candidate));
  }

  const unsafeKey = Object.assign(
    new CreateOnlineCvDto(),
    snapshot({
      contentJson: JSON.parse('{"__proto__":{"polluted":true}}'),
    }),
  );
  assert.notEqual((await validate(unsafeKey)).length, 0);

  let tooDeep = { value: 'leaf' };
  for (let depth = 0; depth < 40; depth += 1) {
    tooDeep = { nested: tooDeep };
  }
  assert.notEqual(
    (await validationErrors(
      CreateOnlineCvDto,
      snapshot({ contentJson: tooDeep }),
    )).length,
    0,
  );
  assert.notEqual(
    (await validationErrors(
      CreateOnlineCvDto,
      snapshot({ contentJson: { text: 'x'.repeat(1024 * 1024) } }),
    )).length,
    0,
  );

  const jsonbObjectOverhead = Buffer.byteLength('{"text": ""}');
  assert.deepEqual(
    await validationErrors(
      CreateOnlineCvDto,
      snapshot({
        contentJson: {
          text: 'x'.repeat(
            MAX_CV_BUILDER_CONTENT_BYTES - jsonbObjectOverhead,
          ),
        },
      }),
    ),
    [],
  );
  assert.notEqual(
    (await validationErrors(
      CreateOnlineCvDto,
      snapshot({
        contentJson: {
          text: 'x'.repeat(
            MAX_CV_BUILDER_CONTENT_BYTES - jsonbObjectOverhead + 1,
          ),
        },
      }),
    )).length,
    0,
  );

  assert.notEqual(
    (await validationErrors(
      CreateOnlineCvDto,
      snapshot({
        contentJson: {
          values: Array.from({ length: 4_000 }, () => 5e-324),
        },
      }),
    )).length,
    0,
    'JSONB exponent expansion must count against the database byte limit',
  );
  for (const unsafeString of ['contains\u0000null', '\ud800']) {
    assert.notEqual(
      (await validationErrors(
        CreateOnlineCvDto,
        snapshot({ contentJson: { text: unsafeString } }),
      )).length,
      0,
    );
  }
});

test('revision DTO requires CAS and validates optional default handover', async () => {
  assert.deepEqual(
    await validationErrors(CreateOnlineCvRevisionDto, {
      ...snapshot(),
      expectedAggregateVersion: 7,
      makeDefault: true,
    }),
    [],
  );
  for (const expectedAggregateVersion of [undefined, 0, 1.5, '1']) {
    const errors = await validationErrors(CreateOnlineCvRevisionDto, {
      ...snapshot(),
      expectedAggregateVersion,
    });
    assert.notEqual(errors.length, 0, String(expectedAggregateVersion));
  }
  assert.notEqual(
    (await validationErrors(CreateOnlineCvRevisionDto, {
      ...snapshot(),
      expectedAggregateVersion: 1,
      makeDefault: 'true',
    })).length,
    0,
  );
});

test('CV Builder exposes canonical plural routes and singular aliases', () => {
  const prototype = CvBuilderController.prototype;
  const expectations = [
    ['create', RequestMethod.POST, ['cvs/online', 'cv/online']],
    ['get', RequestMethod.GET, ['cvs/:id/builder', 'cv/:id/builder']],
    [
      'revise',
      RequestMethod.POST,
      ['cvs/:id/revisions', 'cv/:id/revisions'],
    ],
  ];
  for (const [name, method, paths] of expectations) {
    assert.equal(
      Reflect.getMetadata(METHOD_METADATA, prototype[name]),
      method,
    );
    assert.deepEqual(
      Reflect.getMetadata(PATH_METADATA, prototype[name]),
      paths,
    );
  }
});

test('CV Builder controller delegates only the authenticated Candidate identity', async () => {
  const calls = [];
  const result = { id: CV_ID, type: 'ONLINE' };
  const builder = {
    createOnlineCv: async (...args) => {
      calls.push(['create', ...args]);
      return result;
    },
    getOnlineCv: async (...args) => {
      calls.push(['get', ...args]);
      return result;
    },
    createRevision: async (...args) => {
      calls.push(['revise', ...args]);
      return result;
    },
  };
  const controller = new CvBuilderController(builder);
  const user = { id: USER_ID };
  const createDto = snapshot();
  const reviseDto = { ...snapshot(), expectedAggregateVersion: 1 };

  assert.equal(await controller.create(user, createDto), result);
  assert.equal(await controller.get(user, CV_ID), result);
  assert.equal(await controller.revise(user, CV_ID, reviseDto), result);
  assert.deepEqual(calls, [
    ['create', USER_ID, createDto],
    ['get', USER_ID, CV_ID],
    ['revise', USER_ID, CV_ID, reviseDto],
  ]);
});
