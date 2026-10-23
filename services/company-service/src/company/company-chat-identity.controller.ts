import { Body, Controller, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ChatInternalGuard } from '../common/auth/chat-internal.guard';
import { Public } from '../common/auth/public.decorator';
import { CompanyChatIdentityService } from './company-chat-identity.service';
import { CompanyChatIdentityDto, CompanyChatIdentityRequestDto } from './dto/chat-identity.dto';

@ApiExcludeController()
@Public()
@UseGuards(ChatInternalGuard)
@Controller('internal/v1/chat-identities')
export class CompanyChatIdentityController {
  constructor(private readonly identities: CompanyChatIdentityService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('Pragma', 'no-cache')
  resolve(@Body() request: CompanyChatIdentityRequestDto): Promise<CompanyChatIdentityDto[]> {
    return this.identities.resolve(request.userIds);
  }
}
