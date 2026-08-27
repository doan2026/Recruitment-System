import { Module } from '@nestjs/common';
import { MediaClientModule } from '../media/media-client.module';
import { ProfileMediaController } from './profile-media.controller';
import { ProfileMediaService } from './profile-media.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [MediaClientModule],
  controllers: [ProfileMediaController, ProfileController],
  providers: [ProfileService, ProfileMediaService],
  exports: [ProfileService],
})
export class ProfileModule {}
