import {
  CompanyMemberRole,
  CompanyVerificationStatus,
} from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user.interface';
import { SystemRole } from '../common/auth/system-role.enum';
import { CompanyMemberController } from './company-member.controller';
import { CompanyMemberService } from './company-member.service';

const USER: AuthUser = {
  id: '35ed14a5-b031-4789-bec5-a80a1c19d60b',
  systemRole: SystemRole.RECRUITER,
  claims: {},
};
const ACCESS_TOKEN = 'header.payload.signature';

describe('CompanyMemberController', () => {
  it('passes the verified token and subject to invitation acceptance', async () => {
    const result = {
      companyId: '90eec7f1-fb6e-49d0-89ff-7d65d2438ff7',
      name: 'Acme Vietnam',
      verifiedStatus: CompanyVerificationStatus.VERIFIED,
      memberRole: CompanyMemberRole.MEMBER,
    };
    const members = {
      accept: jest.fn().mockResolvedValue(result),
    } as unknown as CompanyMemberService;
    const controller = new CompanyMemberController(members);
    const dto = { token: 'x'.repeat(43) };

    await expect(
      controller.acceptInvitation(USER, ACCESS_TOKEN, dto),
    ).resolves.toBe(result);
    expect(members.accept).toHaveBeenCalledWith(
      USER.id,
      ACCESS_TOKEN,
      dto,
    );
  });
});
