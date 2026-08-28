import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { CurrentAuthAccountClient } from './current-auth-account.client';
import { HttpCurrentAuthAccountClient } from './http-current-auth-account.client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  imports: [ConfigModule, JwtModule.register({})],
  providers: [
    JwtVerifierService,
    HttpCurrentAuthAccountClient,
    {
      provide: CurrentAuthAccountClient,
      useExisting: HttpCurrentAuthAccountClient,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [CurrentAuthAccountClient, JwtVerifierService],
})
export class AuthModule {}
