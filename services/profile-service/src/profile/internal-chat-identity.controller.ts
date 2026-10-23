import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalCallers, InternalOnly } from '../common/auth/auth.decorators';
import { ChatIdentityService } from './chat-identity.service';
import { ChatIdentityDto, ChatIdentityRequestDto } from './dto/chat-identity.dto';

@ApiExcludeController()
@InternalOnly()
@InternalCallers('chat-service')
@Controller('internal/v1/chat-identities')
export class InternalChatIdentityController {
  constructor(private readonly identities: ChatIdentityService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('Pragma', 'no-cache')
  resolve(@Body() request: ChatIdentityRequestDto): Promise<ChatIdentityDto[]> {
    return this.identities.resolve(request.userIds);
  }
}
