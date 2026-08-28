import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user.interface';
import { success } from '../common/api-envelope';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationQueryDto } from './notification-query.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated user notifications' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: NotificationQueryDto,
  ) {
    const page = await this.inbox.list(
      user.id,
      query.type,
      query.cursor,
      query.limit,
    );
    return success(page.items, {
      nextCursor: page.nextCursor,
      limit: query.limit,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread notifications for the current user' })
  async unreadCount(@CurrentUser() user: AuthUser) {
    return success({ count: await this.inbox.unreadCount(user.id) });
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark current notifications as read' })
  async markAllRead(@CurrentUser() user: AuthUser) {
    return success(await this.inbox.markAllRead(user.id));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one owned notification as read' })
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return success(await this.inbox.markRead(user.id, id));
  }
}
