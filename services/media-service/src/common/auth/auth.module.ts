import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { InternalAuthService } from './internal-auth.service';
import { JwtVerifierService } from './jwt-verifier.service';
import { RequestAuthGuard } from './request-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    JwtVerifierService,
    InternalAuthService,
    {
      provide: APP_GUARD,
      useClass: RequestAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [JwtVerifierService, InternalAuthService],
})
export class AuthModule {}
