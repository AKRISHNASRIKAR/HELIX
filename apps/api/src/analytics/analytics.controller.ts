import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tenant } from '../common/decorators';
import type { TenantContext } from '../common/types';
import { TenantScoped } from '../tenant/tenant.guard';
import { AnalyticsService } from './analytics.service';
import type { AnomalyData, Overview, RevenueData, ThroughputDay } from './analytics.types';

/**
 * Workspace-wide dashboard analytics over the organization's first connected
 * orders-like table (404 when there is none), computed by the analytics
 * engine and cached per organization for 60 seconds.
 */
@ApiTags('analytics')
@TenantScoped()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Headline KPIs (revenue, orders, AOV, refund rate), last 30 days vs prior 30' })
  overview(@Tenant() t: TenantContext): Promise<Overview> {
    return this.analytics.overview(t.organizationId);
  }

  @Get('revenue')
  @ApiOperation({
    summary: 'Daily revenue with the detector expected band, anomalies, forecast, segment split and drop story',
  })
  revenue(@Tenant() t: TenantContext): Promise<RevenueData> {
    return this.analytics.revenue(t.organizationId);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Flagged anomalies across revenue, orders, refunds, customers, plus a |z| heatmap' })
  anomalies(@Tenant() t: TenantContext): Promise<AnomalyData> {
    return this.analytics.anomalies(t.organizationId);
  }

  @Get('throughput')
  @ApiOperation({ summary: 'Investigations created per day by trigger, last 14 days' })
  throughput(@Tenant() t: TenantContext): Promise<ThroughputDay[]> {
    return this.analytics.throughput(t.organizationId);
  }
}
