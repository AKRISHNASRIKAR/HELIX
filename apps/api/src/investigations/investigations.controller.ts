import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvestigationStatus, type Investigation } from '@helix/database';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator';
import { ApiQueries, CurrentUser, Tenant, ZodBody, ZodQuery } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid-param.pipe';
import { TenantScoped } from '../tenant/tenant.guard';
import { InvestigationDetail, InvestigationsService } from './investigations.service';

const CreateInvestigationSchema = z.object({
  projectId: z.string().uuid(),
  question: z.string().trim().min(3).max(2000),
});
const UpdateInvestigationSchema = z.object({ status: z.literal(InvestigationStatus.CANCELLED) });
const ListQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.nativeEnum(InvestigationStatus).optional(),
});

@ApiTags('investigations')
@TenantScoped()
@Controller('investigations')
export class InvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  @ApiOperation({ summary: 'Investigations in the organization, newest first (max 200)' })
  @ApiQueries({ name: 'projectId' }, { name: 'status' })
  findAll(
    @Tenant() t: TenantContext,
    @ZodQuery(ListQuerySchema) q: z.infer<typeof ListQuerySchema>,
  ): Promise<Investigation[]> {
    return this.investigations.findAll(t.organizationId, q);
  }

  @Post()
  @ApiOperation({
    summary:
      'Ask a question: creates a PENDING investigation and starts the Coordinator asynchronously',
  })
  @Audit({ action: 'investigation.create', resourceType: 'investigation' })
  create(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateInvestigationSchema) body: z.infer<typeof CreateInvestigationSchema>,
  ): Promise<Investigation> {
    return this.investigations.create(t.organizationId, user.id, body);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Investigation with steps, tasks, findings, recommendations and events',
  })
  detail(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<InvestigationDetail> {
    return this.investigations.detail(t.organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cancel an investigation (409 once it has finished)' })
  @Audit({ action: 'investigation.cancel', resourceType: 'investigation' })
  update(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @ZodBody(UpdateInvestigationSchema) _body: z.infer<typeof UpdateInvestigationSchema>,
  ): Promise<Investigation> {
    return this.investigations.cancel(t.organizationId, id, user.id);
  }
}
