import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, AuthUser } from './auth-user.interface';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';
import { SystemRole } from './system-role.enum';

const ACCESS_TOKEN = 'header.payload.signature';
const USER: AuthUser = {
  id: '35ed14a5-b031-4789-bec5-a80a1c19d60b',
  systemRole: SystemRole.RECRUITER,
  claims: {},
};

describe('JwtAuthGuard', () => {
  it('retains only the compact token after successful verification', async () => {
    const request = {
      header: jest.fn().mockReturnValue('Bearer ' + ACCESS_TOKEN),
    } as unknown as AuthenticatedRequest;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const verifier = {
      verify: jest.fn().mockResolvedValue(USER),
    } as unknown as JwtVerifierService;
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    const guard = new JwtAuthGuard(reflector, verifier);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(USER);
    expect(request.accessToken).toBe(ACCESS_TOKEN);
    expect(verifier.verify).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it('does not retain an unverified token', async () => {
    const request = {
      header: jest.fn().mockReturnValue('Bearer ' + ACCESS_TOKEN),
    } as unknown as AuthenticatedRequest;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const verifier = {
      verify: jest.fn().mockRejectedValue(new Error('invalid')),
    } as unknown as JwtVerifierService;
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    const guard = new JwtAuthGuard(reflector, verifier);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
    expect(request.accessToken).toBeUndefined();
  });
});
