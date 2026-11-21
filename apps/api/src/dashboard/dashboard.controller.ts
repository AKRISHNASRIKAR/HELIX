import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSourceStatus } from '@helix/database';
import { CurrentUser, Tenant } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/types';
import { CANCELLABLE } from '../investigations/investigations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScoped } from '../tenant/tenant.guard';

export interface DashboardSummary {
  activeInvestigations: number;
  totalInvestigations: number;
  dataSources: number;
  connectedDataSources: number;
  projects: number;
  unreadNotifications: number;
}

@ApiTags('dashboard')
@TenantScoped()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Headline counts for the dashboard' })
  async summary(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
  ): Promise<DashboardSummary> {
    const organizationId = t.organizationId;
    const [
      activeInvestigations,
      totalInvestigations,
      dataSources,
      connectedDataSources,
      projects,
      unread,
    ] = await Promise.all([
      // "Active" = not yet finished; same set a user is still allowed to cancel.
      this.prisma.investigation.count({ where: { organizationId, status: { in: CANCELLABLE } } }),
      this.prisma.investigation.count({ where: { organizationId } }),
      this.prisma.dataSource.count({ where: { organizationId } }),
      this.prisma.dataSource.count({
        where: { organizationId, status: DataSourceStatus.CONNECTED },
      }),
      this.prisma.project.count({ where: { organizationId } }),
      this.notifications.unreadCount(user.id, organizationId),
    ]);
    return {
      activeInvestigations,
      totalInvestigations,
      dataSources,
      connectedDataSources,
      projects,
      unreadNotifications: unread,
    };
  }
}
