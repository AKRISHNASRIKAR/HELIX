import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tenant } from '../common/decorators';
import type { TenantContext } from '../common/types';
import { TenantScoped } from '../tenant/tenant.guard';
import { AgentsService, AgentView } from './agents.service';

@ApiTags('agents')
@TenantScoped()
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({
    summary: "Registered agents (from agent-runtime) with the organization's task stats",
  })
  list(@Tenant() t: TenantContext): Promise<AgentView[]> {
    return this.agents.list(t.organizationId);
  }
}
