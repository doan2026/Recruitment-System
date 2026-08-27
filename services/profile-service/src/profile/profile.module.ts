import { Module } from '@nestjs/common';
import { MediaClientModule } from '../media/media-client.module';
import { InternalCvController } from './internal-cv.controller';
import { InternalCvService } from './internal-cv.service';
import { ProfileMediaController } from './profile-media.controller';
import { ProfileMediaService } from './profile-media.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [MediaClientModule],
  controllers: [
    InternalCvController,
    ProfileMediaController,
    ProfileController,
  ],
  providers: [ProfileService, ProfileMediaService, InternalCvService],
  exports: [ProfileService],
})
export class ProfileModule {}
