import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Notification } from '@helix/database';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator';
import { ApiQueries, CurrentUser, ZodQuery } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { UuidPipe } from '../common/uuid-param.pipe';
import { NotificationsService } from './notifications.service';

const ListQuerySchema = z.object({
  unread: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "Current user's notifications, newest first (max 100)" })
  @ApiQueries({ name: 'unread', description: 'true to return only unread' })
  list(
    @CurrentUser() user: AuthUser,
    @ZodQuery(ListQuerySchema) q: z.infer<typeof ListQuerySchema>,
  ): Promise<Notification[]> {
    return this.notifications.list(user.id, q.unread);
  }

  @Post('read-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark every notification as read' })
  @Audit({ action: 'notification.read_all', resourceType: 'notification', resourceId: () => null })
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark one notification as read' })
  @Audit({ action: 'notification.read', resourceType: 'notification' })
  async read(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }
}
