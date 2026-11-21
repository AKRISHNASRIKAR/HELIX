import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator';
import { Tenant, ZodBody } from '../common/decorators';
import type { TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid-param.pipe';
import { TenantScoped } from '../tenant/tenant.guard';
import { ProjectsService, ProjectView } from './projects.service';

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
});
const UpdateProjectSchema = CreateProjectSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'Nothing to update',
});

@ApiTags('projects')
@TenantScoped()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects in the organization' })
  list(@Tenant() t: TenantContext): Promise<ProjectView[]> {
    return this.projects.list(t.organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  @Audit({ action: 'project.create', resourceType: 'project' })
  create(
    @Tenant() t: TenantContext,
    @ZodBody(CreateProjectSchema) body: z.infer<typeof CreateProjectSchema>,
  ): Promise<ProjectView> {
    return this.projects.create(t.organizationId, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project' })
  get(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<ProjectView> {
    return this.projects.get(t.organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @Audit({ action: 'project.update', resourceType: 'project' })
  update(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @ZodBody(UpdateProjectSchema) body: z.infer<typeof UpdateProjectSchema>,
  ): Promise<ProjectView> {
    return this.projects.update(t.organizationId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a project and its investigations' })
  @Audit({ action: 'project.delete', resourceType: 'project' })
  async remove(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.projects.remove(t.organizationId, id);
  }
}
