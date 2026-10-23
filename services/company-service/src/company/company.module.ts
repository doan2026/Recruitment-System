import { Module } from '@nestjs/common';
import { ChatInternalGuard } from '../common/auth/chat-internal.guard';
import { CompanyChatIdentityController } from './company-chat-identity.controller';
import { CompanyChatIdentityService } from './company-chat-identity.service';
import { CompanyMediaOperationService } from '../media/company-media-operation.service';
import { MediaClientModule } from '../media/media-client.module';
import { CompanyMemberController } from './company-member.controller';
import { CompanyMemberService } from './company-member.service';
import { CompanyPublicSearchCursorService } from './company-public-search-cursor.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [MediaClientModule],
  controllers: [CompanyController, CompanyMemberController, CompanyChatIdentityController],
  providers: [
    ChatInternalGuard,
    CompanyChatIdentityService,
    CompanyService,
    CompanyMemberService,
    CompanyPublicSearchCursorService,
    CompanyMediaOperationService,
  ],
})
export class CompanyModule {}
