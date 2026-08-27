import { Module } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CloudinaryStorageProvider } from '../storage/cloudinary-storage.provider';
import { StorageProvider } from '../storage/storage-provider';
import {
  InternalMediaController,
  MediaController,
} from './media.controller';
import {
  MEDIA_CLEANUP_WORKER_ID,
  MediaCleanupScheduler,
  MediaMaintenanceService,
} from './media-maintenance.service';
import { MEDIA_CLOCK, MediaService } from './media.service';

@Module({
  controllers: [MediaController, InternalMediaController],
  providers: [
    MediaService,
    MediaMaintenanceService,
    MediaCleanupScheduler,
    {
      provide: StorageProvider,
      useClass: CloudinaryStorageProvider,
    },
    {
      provide: MEDIA_CLOCK,
      useValue: (): Date => new Date(),
    },
    {
      provide: MEDIA_CLEANUP_WORKER_ID,
      useFactory: (): string => 'cleanup-' + randomUUID(),
    },
  ],
  exports: [
    MediaService,
    MediaMaintenanceService,
    MediaCleanupScheduler,
    StorageProvider,
  ],
})
export class MediaModule {}
