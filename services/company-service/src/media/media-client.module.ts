import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompanyMediaClient } from './company-media.client';
import { HttpCompanyMediaClient } from './http-company-media.client';

@Module({
  imports: [ConfigModule],
  providers: [
    HttpCompanyMediaClient,
    {
      provide: CompanyMediaClient,
      useExisting: HttpCompanyMediaClient,
    },
  ],
  exports: [CompanyMediaClient, HttpCompanyMediaClient],
})
export class MediaClientModule {}
