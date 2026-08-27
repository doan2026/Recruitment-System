import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { InternalAuthService } from './internal-auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    JwtVerifierService,
    InternalAuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtVerifierService, InternalAuthService],
})
export class AuthModule {}
