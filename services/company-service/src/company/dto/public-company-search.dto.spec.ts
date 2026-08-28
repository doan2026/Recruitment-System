import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  canonicalizePublicCompanySearchQuery,
  PublicCompanySearchMetaDto,
  PublicCompanySearchQueryDto,
  PublicCompanySearchSummaryDto,
} from './public-company-search.dto';

describe('PublicCompanySearch DTOs', () => {
  it('applies defaults and canonicalizes NFKC and Unicode whitespace', async () => {
    const defaults = plainToInstance(PublicCompanySearchQueryDto, {});
    expect(await validate(defaults)).toHaveLength(0);
    expect(defaults).toEqual(expect.objectContaining({ limit: 20 }));
    expect(defaults.q).toBeUndefined();
    expect(defaults.cursor).toBeUndefined();

    const transformed = plainToInstance(PublicCompanySearchQueryDto, {
      q: '  ＡＣＭＥ\u3000 Việt\nNam  ',
      cursor: 'abc.DEF-_',
      limit: '50',
    });
    expect(await validate(transformed)).toHaveLength(0);
    expect(transformed).toMatchObject({
      q: 'ACME Việt Nam',
      cursor: 'abc.DEF-_',
      limit: 50,
    });
    expect(canonicalizePublicCompanySearchQuery('  A\u00a0 B  ')).toBe(
      'A B',
    );
  });

  it.each([
    { q: '' },
    { q: '   ' },
    { q: 'a'.repeat(101) },
    { q: 42 },
    { q: 'acme\u0000corp' },
    { q: 'acme\u200dcorp' },
    { cursor: '' },
    { cursor: 'contains space' },
    { cursor: 'line\nbreak' },
    { cursor: 'é' },
    { cursor: 'a'.repeat(1_025) },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
  ])('rejects an invalid public Company query: %j', async (input) => {
    const dto = plainToInstance(PublicCompanySearchQueryDto, input);
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts q, cursor and limit at their exact boundaries', async () => {
    for (const input of [
      { q: 'a', cursor: 'x', limit: '1' },
      { q: 'a'.repeat(100), cursor: 'x'.repeat(1_024), limit: '50' },
    ]) {
      const dto = plainToInstance(PublicCompanySearchQueryDto, input);
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('forbids unknown query parameters through the global validation policy', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { q: 'acme', verified_status: 'PENDING' },
        {
          type: 'query',
          metatype: PublicCompanySearchQueryDto,
          data: undefined,
        },
      ),
    ).rejects.toBeDefined();
  });

  it('validates the public summary and pagination meta projections', async () => {
    const summary = plainToInstance(PublicCompanySearchSummaryDto, {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Acme',
      slug: 'acme',
      industry: 'Technology',
      size: '51-100',
      address: 'Ha Noi',
      logoUrl: null,
    });
    const meta = plainToInstance(PublicCompanySearchMetaDto, {
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });
    expect(await validate(summary)).toHaveLength(0);
    expect(await validate(meta)).toHaveLength(0);

    const invalidMeta = plainToInstance(PublicCompanySearchMetaDto, {
      limit: 51,
      hasMore: 'false',
      nextCursor: 'not ascii 🙂',
    });
    expect(await validate(invalidMeta)).not.toHaveLength(0);
  });
});
