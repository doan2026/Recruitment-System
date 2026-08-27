import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApplicationCvUsageClient } from './application-cv-usage.client';
import { HttpApplicationCvUsageClient } from './http-application-cv-usage.client';

@Module({
  imports: [ConfigModule],
  providers: [
    HttpApplicationCvUsageClient,
    {
      provide: ApplicationCvUsageClient,
      useExisting: HttpApplicationCvUsageClient,
    },
  ],
  exports: [ApplicationCvUsageClient, HttpApplicationCvUsageClient],
})
export class ApplicationClientModule {}
