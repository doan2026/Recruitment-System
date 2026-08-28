import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MediaClientModule } from './media/media-client.module';
import { PrismaModule } from './prisma/prisma.module';
import { CvEventBaselineService } from './profile/cv-event-baseline.service';
import { CvEventPublisherService } from './profile/cv-event-publisher.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MediaClientModule,
  ],
  providers: [CvEventBaselineService, CvEventPublisherService],
})
export class CvEventBaselineModule {}
