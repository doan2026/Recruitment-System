import { Module } from '@nestjs/common';
import { CompanyMemberController } from './company-member.controller';
import { CompanyMemberService } from './company-member.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  controllers: [CompanyController, CompanyMemberController],
  providers: [CompanyService, CompanyMemberService],
})
export class CompanyModule {}
