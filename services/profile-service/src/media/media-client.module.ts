import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpProfileMediaClient } from './http-profile-media.client';
import { ProfileMediaClient } from './profile-media.client';

@Module({
  imports: [ConfigModule],
  providers: [
    HttpProfileMediaClient,
    {
      provide: ProfileMediaClient,
      useExisting: HttpProfileMediaClient,
    },
  ],
  exports: [ProfileMediaClient, HttpProfileMediaClient],
})
export class MediaClientModule {}
