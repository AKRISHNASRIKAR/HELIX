import {
  applyDecorators,
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { OrganizationRole } from '@helix/database';
import { MIN_ROLE_KEY } from '../common/decorators';
import type { HelixRequest } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { roleAtLeast } from './roles';

export const ORG_HEADER = 'x-organization-id';
const TENANT_PARAM_KEY = 'helix:tenantParam';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Resolves the organization a request acts on, verifies the JWT user is a
 * member, enforces the handler's minimum role, and attaches
 * `req.tenant = { organizationId, role }`. Services must take organizationId
 * from that context only, never from the body or query string.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HelixRequest>();
    if (!req.user) throw new UnauthorizedException();

    const targets = [ctx.getHandler(), ctx.getClass()];
    const param = this.reflector.getAllAndOverride<string | undefined>(TENANT_PARAM_KEY, targets);
    const raw = param ? req.params[param] : req.headers[ORG_HEADER];
    const organizationId = Array.isArray(raw) ? raw[0] : raw;
    if (!organizationId) {
      throw new BadRequestException('X-Organization-Id header is required');
    }
    if (!UUID_RE.test(organizationId)) {
      throw new BadRequestException('Organization id must be a UUID');
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: req.user.id } },
      select: { role: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this organization');

    const min =
      this.reflector.getAllAndOverride<OrganizationRole | undefined>(MIN_ROLE_KEY, targets) ??
      (READ_METHODS.has(req.method.toUpperCase())
        ? OrganizationRole.VIEWER
        : OrganizationRole.MEMBER);
    if (!roleAtLeast(membership.role, min)) {
      throw new ForbiddenException(`Requires ${min} role or higher`);
    }

    req.tenant = { organizationId, role: membership.role };
    return true;
  }
}

/** Tenant-scoped controller/handler: organization comes from the X-Organization-Id header. */
export const TenantScoped = () =>
  applyDecorators(
    UseGuards(TenantGuard),
    ApiBearerAuth(),
    ApiHeader({ name: 'X-Organization-Id', required: true, description: 'Organization UUID' }),
  );

/** Tenant-scoped via a route param instead (e.g. /organizations/:id/members). */
export const TenantFromParam = (param: string) =>
  applyDecorators(SetMetadata(TENANT_PARAM_KEY, param), UseGuards(TenantGuard), ApiBearerAuth());
