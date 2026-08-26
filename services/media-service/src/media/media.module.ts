import { Module } from '@nestjs/common';
import { CloudinaryStorageProvider } from '../storage/cloudinary-storage.provider';
import { StorageProvider } from '../storage/storage-provider';
import {
  InternalMediaController,
  MediaController,
} from './media.controller';
import { MEDIA_CLOCK, MediaService } from './media.service';

@Module({
  controllers: [MediaController, InternalMediaController],
  providers: [
    MediaService,
    {
      provide: StorageProvider,
      useClass: CloudinaryStorageProvider,
    },
    {
      provide: MEDIA_CLOCK,
      useValue: (): Date => new Date(),
    },
  ],
  exports: [MediaService, StorageProvider],
})
export class MediaModule {}
