import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationRole } from '@helix/database';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator';
import { CurrentUser, MinRole, Tenant, ZodBody } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid-param.pipe';
import { TenantFromParam } from '../tenant/tenant.guard';
import { MemberView, OrganizationsService, OrganizationView } from './organizations.service';

const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens')
    .optional(),
});
const RoleSchema = z.nativeEnum(OrganizationRole);
const AddMemberSchema = z.object({
  email: z.string().trim().email(),
  role: RoleSchema.default('MEMBER'),
});
const UpdateMemberSchema = z.object({ role: RoleSchema });

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an organization (creator becomes OWNER)' })
  @Audit({ action: 'organization.create', resourceType: 'organization' })
  create(
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateOrganizationSchema) body: z.infer<typeof CreateOrganizationSchema>,
  ): Promise<OrganizationView> {
    return this.orgs.create(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: "Organizations the current user belongs to, with the user's role" })
  list(@CurrentUser() user: AuthUser): Promise<OrganizationView[]> {
    return this.orgs.listForUser(user.id);
  }

  @Get(':id/members')
  @TenantFromParam('id')
  @ApiOperation({ summary: 'List members' })
  members(@Tenant() t: TenantContext): Promise<MemberView[]> {
    return this.orgs.listMembers(t.organizationId);
  }

  @Post(':id/members')
  @TenantFromParam('id')
  @MinRole(OrganizationRole.ADMIN)
  @ApiOperation({ summary: 'Add an existing user to the organization (ADMIN+)' })
  @Audit({
    action: 'organization.member.add',
    resourceType: 'organization_member',
    resourceId: (m: MemberView) => m.userId,
  })
  addMember(
    @Tenant() t: TenantContext,
    @ZodBody(AddMemberSchema) body: z.infer<typeof AddMemberSchema>,
  ): Promise<MemberView> {
    return this.orgs.addMember(t, body);
  }

  @Patch(':id/members/:userId')
  @TenantFromParam('id')
  @MinRole(OrganizationRole.ADMIN)
  @ApiOperation({ summary: "Change a member's role (ADMIN+; OWNER changes need OWNER)" })
  @Audit({
    action: 'organization.member.update',
    resourceType: 'organization_member',
    resourceId: (_res, req) => req.params.userId,
  })
  updateMember(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) _id: string,
    @Param('userId', UuidPipe) userId: string,
    @ZodBody(UpdateMemberSchema) body: z.infer<typeof UpdateMemberSchema>,
  ): Promise<MemberView> {
    return this.orgs.updateMember(t, userId, body.role);
  }

  @Delete(':id/members/:userId')
  @TenantFromParam('id')
  @MinRole(OrganizationRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a member (ADMIN+; cannot remove the last OWNER)' })
  @Audit({
    action: 'organization.member.remove',
    resourceType: 'organization_member',
    resourceId: (_res, req) => req.params.userId,
  })
  async removeMember(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) _id: string,
    @Param('userId', UuidPipe) userId: string,
  ): Promise<void> {
    await this.orgs.removeMember(t, userId);
  }
}
