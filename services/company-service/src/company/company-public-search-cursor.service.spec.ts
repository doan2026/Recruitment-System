import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  CompanyPublicSearchCursorService,
} from './company-public-search-cursor.service';

const KEY = 'cursor-secret-with-at-least-32-bytes-1234567890';
const OTHER_KEY = 'another-secret-with-at-least-32-bytes-12345678';
const COMPANY_ID = 'a1111111-a111-4111-8111-a11111111111';

describe('CompanyPublicSearchCursorService', () => {
  const service = createService(KEY);

  it('round-trips a canonical HMAC-SHA256 base64url cursor', () => {
    const encoded = service.encode('acme', 20, {
      normalizedName: 'acme việt nam',
      id: COMPANY_ID,
    });

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(encoded).not.toContain('=');
    expect(service.decode(encoded, 'acme', 20)).toEqual({
      normalizedName: 'acme việt nam',
      id: COMPANY_ID,
    });
    expect(service.decode(undefined, null, 20)).toBeNull();
  });

  it.each([
    ['query', 'other', 20],
    ['limit', 'acme', 21],
  ])('rejects a valid cursor used with the wrong %s scope', (_name, q, limit) => {
    const encoded = service.encode('acme', 20, {
      normalizedName: 'acme',
      id: COMPANY_ID,
    });
    expect(() => service.decode(encoded, q, limit)).toThrow(
      expect.objectContaining({
        code: 'COMPANY_SEARCH_CURSOR_SCOPE_MISMATCH',
      }),
    );
  });

  it('rejects a tampered body or signature', () => {
    const encoded = service.encode(null, 20, {
      normalizedName: 'acme',
      id: COMPANY_ID,
    });
    const [body, signature] = encoded.split('.');
    const changedBody = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}`;
    const changedSignature = `${signature.slice(0, -1)}${
      signature.endsWith('A') ? 'B' : 'A'
    }`;

    expectInvalid(() => service.decode(`${changedBody}.${signature}`, null, 20));
    expectInvalid(() => service.decode(`${body}.${changedSignature}`, null, 20));
    expectInvalid(() => service.decode(`${body}.${signature}=`, null, 20));
  });

  it.each([
    {
      payload: { v: 2, q: null, l: 20, n: 'acme', i: COMPANY_ID },
      label: 'wrong version',
    },
    {
      payload: { v: 1, q: null, l: 20, n: 'acme', i: COMPANY_ID, x: true },
      label: 'extra field',
    },
    {
      payload: { q: null, v: 1, l: 20, n: 'acme', i: COMPANY_ID },
      label: 'noncanonical order',
    },
    {
      payload: { v: 1, q: ' acme ', l: 20, n: 'acme', i: COMPANY_ID },
      label: 'noncanonical query',
    },
    {
      payload: { v: 1, q: null, l: 20, n: 'Acme', i: COMPANY_ID },
      label: 'noncanonical name',
    },
    {
      payload: { v: 1, q: null, l: 20, n: 'a', i: COMPANY_ID },
      label: 'short name',
    },
    {
      payload: {
        v: 1,
        q: null,
        l: 20,
        n: 'acme',
        i: COMPANY_ID.toUpperCase(),
      },
      label: 'uppercase UUID',
    },
    {
      payload: {
        v: 1,
        q: null,
        l: 20,
        n: 'acme',
        i: '11111111-1111-5111-8111-111111111111',
      },
      label: 'non-v4 UUID',
    },
  ])('rejects a validly signed $label payload', ({ payload }) => {
    expectInvalid(() => service.decode(signPayload(payload, KEY), null, 20));
  });

  it('rejects malformed, noncanonical and oversized encodings', () => {
    const encoded = service.encode(null, 20, {
      normalizedName: 'acme',
      id: COMPANY_ID,
    });
    const [body, signature] = encoded.split('.');

    for (const invalid of [
      '',
      'one-part',
      `${body}.${signature}.third`,
      `${body}+.${signature}`,
      `${body}.${signature.slice(0, 42)}`,
      `${'a'.repeat(1_025)}.${signature}`,
    ]) {
      expectInvalid(() => service.decode(invalid, null, 20));
    }
  });

  it('rejects a cursor signed with another key', () => {
    const encoded = createService(OTHER_KEY).encode(null, 20, {
      normalizedName: 'acme',
      id: COMPANY_ID,
    });
    expectInvalid(() => service.decode(encoded, null, 20));
  });

  it.each([
    undefined,
    '',
    'short',
    ' replace-with-a-real-cursor-secret-123456789 ',
    'replace-with-a-real-cursor-secret-123456789',
    'change-me-cursor-secret-1234567890123456789',
    'placeholder-cursor-secret-123456789012345',
    'your-secret-cursor-value-12345678901234567',
    'example-cursor-secret-1234567890123456789',
    'valid-looking-secret-with-control-12345\n',
  ])('fails closed for an invalid HMAC configuration: %j', (key) => {
    expect(() => createService(key)).toThrow(
      /COMPANY_PUBLIC_CURSOR_HMAC_KEY.*at least 32 UTF-8 bytes/,
    );
  });

  it('counts HMAC configuration length in UTF-8 bytes', () => {
    expect(() => createService('bí-mật-' + 'á'.repeat(13))).not.toThrow();
  });

  it('rejects invalid values passed to encode defensively', () => {
    expectInvalid(() =>
      service.encode(null, 0, { normalizedName: 'acme', id: COMPANY_ID }),
    );
    expectInvalid(() =>
      service.encode(' acme ', 20, {
        normalizedName: 'acme',
        id: COMPANY_ID,
      }),
    );
    expectInvalid(() =>
      service.encode(null, 20, {
        normalizedName: 'Acme',
        id: COMPANY_ID,
      }),
    );
  });
});

function createService(key: unknown): CompanyPublicSearchCursorService {
  return new CompanyPublicSearchCursorService({
    get: jest.fn().mockImplementation((name: string) =>
      name === 'COMPANY_PUBLIC_CURSOR_HMAC_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService);
}

function signPayload(payload: unknown, key: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', key)
    .update(body, 'utf8')
    .digest('base64url');
  return `${body}.${signature}`;
}

function expectInvalid(action: () => unknown): void {
  expect(action).toThrow(
    expect.objectContaining({ code: 'COMPANY_SEARCH_CURSOR_INVALID' }),
  );
}
