import { Module } from '@nestjs/common';
import { ChatIdentityService } from './chat-identity.service';
import { InternalChatIdentityController } from './internal-chat-identity.controller';
import { ApplicationClientModule } from '../application/application-client.module';
import { MediaClientModule } from '../media/media-client.module';
import { CvBuilderController } from './cv-builder.controller';
import { CvBuilderService } from './cv-builder.service';
import { CvDeletionService } from './cv-deletion.service';
import { CvEventPublisherService } from './cv-event-publisher.service';
import { CvMediaCleanupService } from './cv-media-cleanup.service';
import { InternalCvController } from './internal-cv.controller';
import { InternalCvService } from './internal-cv.service';
import { InternalCvV2Controller } from './internal-cv-v2.controller';
import { InternalCvV2Service } from './internal-cv-v2.service';
import { InternalRecruiterDiscoveryController } from './internal-recruiter-discovery.controller';
import { JobPreferenceController } from './job-preference.controller';
import { JobPreferenceService } from './job-preference.service';
import { ProfileMediaController } from './profile-media.controller';
import { ProfileMediaService } from './profile-media.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { RecruiterDiscoveryController } from './recruiter-discovery.controller';
import { RecruiterDiscoveryService } from './recruiter-discovery.service';

@Module({
  imports: [ApplicationClientModule, MediaClientModule],
  controllers: [
    InternalChatIdentityController,
    InternalCvController,
    InternalCvV2Controller,
    InternalRecruiterDiscoveryController,
    CvBuilderController,
    JobPreferenceController,
    RecruiterDiscoveryController,
    ProfileMediaController,
    ProfileController,
  ],
  providers: [
    ChatIdentityService,
    ProfileService,
    ProfileMediaService,
    CvBuilderService,
    CvDeletionService,
    CvEventPublisherService,
    CvMediaCleanupService,
    InternalCvService,
    InternalCvV2Service,
    JobPreferenceService,
    RecruiterDiscoveryService,
  ],
  exports: [ProfileService],
})
export class ProfileModule {}
