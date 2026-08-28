import { Module } from '@nestjs/common';
import { ApplicationClientModule } from '../application/application-client.module';
import { MediaClientModule } from '../media/media-client.module';
import { CvBuilderController } from './cv-builder.controller';
import { CvBuilderService } from './cv-builder.service';
import { CvDeletionService } from './cv-deletion.service';
import { CvEventPublisherService } from './cv-event-publisher.service';
import { CvMediaCleanupService } from './cv-media-cleanup.service';
import { InternalCvController } from './internal-cv.controller';
import { InternalCvService } from './internal-cv.service';
import { ProfileMediaController } from './profile-media.controller';
import { ProfileMediaService } from './profile-media.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [ApplicationClientModule, MediaClientModule],
  controllers: [
    InternalCvController,
    CvBuilderController,
    ProfileMediaController,
    ProfileController,
  ],
  providers: [
    ProfileService,
    ProfileMediaService,
    CvBuilderService,
    CvDeletionService,
    CvEventPublisherService,
    CvMediaCleanupService,
    InternalCvService,
  ],
  exports: [ProfileService],
})
export class ProfileModule {}
