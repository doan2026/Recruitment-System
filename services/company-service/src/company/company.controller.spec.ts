import { AuthUser } from '../common/auth/auth-user.interface';
import { SystemRole } from '../common/auth/system-role.enum';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import {
  CompanyVerificationDecision,
  VerifyCompanyDto,
} from './dto/verify-company.dto';

const ADMIN_ID = '5cfd754e-aef2-4f16-a459-e07983b81e79';
const SPOOFED_ACTOR_ID = '99eec7f1-fb6e-49d0-89ff-7d65d2438ff9';
const COMPANY_ID = '90eec7f1-fb6e-49d0-89ff-7d65d2438ff7';

describe('CompanyController', () => {
  it('forwards the authenticated Admin id for verification and ignores a DTO actor', async () => {
    const companyService = {
      verify: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new CompanyController(
      companyService as unknown as CompanyService,
    );
    const user: AuthUser = {
      id: ADMIN_ID,
      systemRole: SystemRole.ADMIN,
      claims: {},
    };
    const dto = {
      decision: CompanyVerificationDecision.APPROVE,
      actorId: SPOOFED_ACTOR_ID,
    } as VerifyCompanyDto & { actorId: string };

    await controller.verify(user, COMPANY_ID, dto);

    expect(companyService.verify).toHaveBeenCalledTimes(1);
    expect(companyService.verify).toHaveBeenCalledWith(
      ADMIN_ID,
      COMPANY_ID,
      dto,
    );
    expect(companyService.verify).not.toHaveBeenCalledWith(
      SPOOFED_ACTOR_ID,
      COMPANY_ID,
      expect.anything(),
    );
  });
});
