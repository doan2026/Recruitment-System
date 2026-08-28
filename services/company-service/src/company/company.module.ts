import { Module } from '@nestjs/common';
import { CompanyMediaOperationService } from '../media/company-media-operation.service';
import { MediaClientModule } from '../media/media-client.module';
import { CompanyMemberController } from './company-member.controller';
import { CompanyMemberService } from './company-member.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [MediaClientModule],
  controllers: [CompanyController, CompanyMemberController],
  providers: [
    CompanyService,
    CompanyMemberService,
    CompanyMediaOperationService,
  ],
})
export class CompanyModule {}
