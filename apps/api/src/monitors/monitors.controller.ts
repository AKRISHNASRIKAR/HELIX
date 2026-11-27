import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnomalySeverity, OrganizationRole } from '@helix/database';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator';
import { ApiQueries, CurrentUser, MinRole, Tenant, ZodBody, ZodQuery } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid-param.pipe';
import { TenantScoped } from '../tenant/tenant.guard';
import type { MonitorRunResult, MonitorSeriesView } from './monitoring.service';
import type { MonitorSuggestion } from './monitor-rules';
import { AGGREGATIONS, AnomalyView, MonitorView, MonitorsService } from './monitors.service';

const Column = z.string().trim().min(1).max(200);
const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const FilterSchema = z.object({
  column: Column,
  op: z.enum(['eq', 'neq', 'in']),
  value: z.union([Scalar, z.array(Scalar).min(1)]),
});
const Tunables = {
  minSeverity: z.nativeEnum(AnomalySeverity).optional(),
  lookbackDays: z.number().int().min(1).max(365).optional(),
  cooldownHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .optional(),
  enabled: z.boolean().optional(),
};

const CreateMonitorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  projectId: z.string().uuid(),
  dataSourceId: z.string().uuid(),
  metricKey: z.string().trim().min(1).max(100),
  tableName: z.string().trim().min(1).max(500),
  timeColumn: Column,
  valueColumn: Column.nullish(),
  aggregation: z.enum(AGGREGATIONS),
  filter: FilterSchema.nullish(),
  unit: z.string().trim().min(1).max(50).nullish(),
  ...Tunables,
});
const UpdateMonitorSchema = z
  .object({ name: z.string().trim().min(1).max(200).optional(), ...Tunables })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

@ApiTags('monitors')
@TenantScoped()
@Controller('monitors')
export class MonitorsController {
  constructor(private readonly monitors: MonitorsService) {}

  @Get()
  @ApiOperation({
    summary: 'Monitors in the organization with their last run and latest investigation',
  })
  list(@Tenant() t: TenantContext): Promise<MonitorView[]> {
    return this.monitors.list(t.organizationId);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Suggested monitors (revenue, orders, refunds, active customers) for connected tables',
  })
  suggestions(@Tenant() t: TenantContext): Promise<MonitorSuggestion[]> {
    return this.monitors.suggestions(t.organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a monitor on a daily metric of a data source table' })
  @Audit({ action: 'monitor.create', resourceType: 'monitor' })
  create(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateMonitorSchema) body: z.infer<typeof CreateMonitorSchema>,
  ): Promise<MonitorView> {
    return this.monitors.create(t.organizationId, user.id, body);
  }

  @Post('run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run every enabled monitor of the organization now' })
  @Audit({ action: 'monitor.run_all', resourceType: 'monitor', resourceId: () => null })
  runAll(@Tenant() t: TenantContext): Promise<MonitorRunResult[]> {
    return this.monitors.runAll(t.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One monitor' })
  get(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<MonitorView> {
    return this.monitors.get(t.organizationId, id);
  }

  @Get(':id/series')
  @ApiOperation({
    summary: "The monitor's daily series with every detected anomaly (read-only)",
    description:
      'Returns { series: [{ date, value }], anomalies, picked, seriesEnd, lookbackDays, minSeverity }. ' +
      '`picked` is the anomaly a run would act on now. 503 when the analytics engine fails.',
  })
  series(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<MonitorSeriesView> {
    return this.monitors.series(t.organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename, enable/disable or tune a monitor' })
  @Audit({ action: 'monitor.update', resourceType: 'monitor' })
  update(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @ZodBody(UpdateMonitorSchema) body: z.infer<typeof UpdateMonitorSchema>,
  ): Promise<MonitorView> {
    return this.monitors.update(t.organizationId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole(OrganizationRole.ADMIN)
  @ApiOperation({ summary: 'Delete a monitor (ADMIN+); its investigations are kept' })
  @Audit({ action: 'monitor.delete', resourceType: 'monitor' })
  async remove(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.monitors.remove(t.organizationId, id);
  }

  @Post(':id/run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run one monitor now',
    description:
      'Returns { monitorId, monitorName, status, message, investigationId?, anomaly? } where status is ' +
      'ok | investigation_opened | deduped | rate_limited | error.',
  })
  @Audit({ action: 'monitor.run', resourceType: 'monitor', resourceId: (r) => r?.monitorId })
  run(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<MonitorRunResult> {
    return this.monitors.run(t.organizationId, id);
  }
}

const AnomaliesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@ApiTags('monitors')
@TenantScoped()
@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly monitors: MonitorsService) {}

  @Get()
  @ApiOperation({ summary: 'Recent anomalies in the organization, newest first' })
  @ApiQueries({ name: 'limit', description: '1-200, default 50' })
  list(
    @Tenant() t: TenantContext,
    @ZodQuery(AnomaliesQuerySchema) q: z.infer<typeof AnomaliesQuerySchema>,
  ): Promise<AnomalyView[]> {
    return this.monitors.anomalies(t.organizationId, q.limit);
  }
}
