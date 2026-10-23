import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateSync } from 'class-validator';
import { ChatInternalGuard } from '../common/auth/chat-internal.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyChatIdentityService } from './company-chat-identity.service';
import { CompanyChatIdentityRequestDto } from './dto/chat-identity.dto';

const key = 'chat-to-company-test-key-0000000000000001';
const id = '1795c0de-7908-4ab5-9bed-4c4f1cf9c211';
const context = (provided: unknown, caller: unknown = 'chat-service') => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-internal-api-key': provided, 'x-internal-service': caller } }) }) }) as unknown as ExecutionContext;
const guard = (configured: string | undefined = key) => new ChatInternalGuard({ get: (name: string) => name === 'INTERNAL_API_KEY_CHAT' ? configured : 'different-job-search-key-0000000000001' } as unknown as ConfigService);

describe('Company chat display identity', () => {
  it('requires the exact Chat service key and identity', () => {
    expect(guard().canActivate(context(key))).toBe(true);
    for (const [provided, caller] of [[undefined, 'chat-service'], [key + 'x', 'chat-service'], [[key], 'chat-service'], [key, 'job-search-service'], [key, undefined]]) {
      expect(() => guard().canActivate(context(provided, caller ?? null))).toThrow(expect.objectContaining({ code: 'INVALID_INTERNAL_API_KEY' }));
    }
    expect(() => guard('replace-with-a-distinct-chat-key-00000001').canActivate(context(key))).toThrow(expect.objectContaining({ code: 'INTERNAL_API_KEY_NOT_CONFIGURED' }));
  });

  it('bounds requests and rejects duplicate/invalid IDs', () => {
    for (const userIds of [[], [id, id], ['invalid'], Array.from({ length: 101 }, () => id)]) {
      expect(validateSync(Object.assign(new CompanyChatIdentityRequestDto(), { userIds })).length).toBeGreaterThan(0);
    }
    expect(validateSync(Object.assign(new CompanyChatIdentityRequestDto(), { userIds: [id] }))).toHaveLength(0);
  });

  it('projects only current company identification, without member/private company data', async () => {
    const findMany = jest.fn().mockResolvedValue([{ userId: id, role: 'OWNER', company: { id, name: 'Demo Company', logoUrl: 'https://example.test/logo.png', taxCode: 'private' } }]);
    const service = new CompanyChatIdentityService({ companyMember: { findMany } } as unknown as PrismaService);
    expect(await service.resolve([id])).toEqual([{ userId: id, companyId: id, name: 'Demo Company', avatarUrl: 'https://example.test/logo.png' }]);
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: { in: [id] } });
  });
});
