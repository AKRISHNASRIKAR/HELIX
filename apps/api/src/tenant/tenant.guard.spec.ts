import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole } from '@helix/database';
import { MIN_ROLE_KEY } from '../common/decorators';
import type { PrismaService } from '../prisma/prisma.service';
import { TenantGuard } from './tenant.guard';

const ORG = '11111111-1111-4111-8111-111111111111';

function ctxFor(req: Record<string, unknown>, minRole?: OrganizationRole): ExecutionContext {
  const handler = () => undefined;
  if (minRole) Reflect.defineMetadata(MIN_ROLE_KEY, minRole, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  const findUnique = jest.fn();
  const guard = new TenantGuard(new Reflector(), {
    organizationMember: { findUnique },
  } as unknown as PrismaService);
  const req = (method: string, headers: Record<string, string> = { 'x-organization-id': ORG }) => ({
    method,
    headers,
    params: {},
    user: { id: 'user-1', email: 'a@b.c' },
  });

  beforeEach(() => findUnique.mockReset());

  it('attaches the tenant context for a member', async () => {
    findUnique.mockResolvedValue({ role: OrganizationRole.MEMBER });
    const r = req('GET');
    await expect(guard.canActivate(ctxFor(r))).resolves.toBe(true);
    expect(r).toMatchObject({ tenant: { organizationId: ORG, role: 'MEMBER' } });
  });

  it('rejects non-members with 403', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctxFor(req('GET')))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires the X-Organization-Id header', async () => {
    await expect(guard.canActivate(ctxFor(req('GET', {})))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('lets a VIEWER read', async () => {
    findUnique.mockResolvedValue({ role: OrganizationRole.VIEWER });
    await expect(guard.canActivate(ctxFor(req('GET')))).resolves.toBe(true);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'blocks a VIEWER from %s by default',
    async (method) => {
      findUnique.mockResolvedValue({ role: OrganizationRole.VIEWER });
      await expect(guard.canActivate(ctxFor(req(method)))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('enforces @MinRole(ADMIN) against a MEMBER and allows an OWNER', async () => {
    findUnique.mockResolvedValue({ role: OrganizationRole.MEMBER });
    await expect(
      guard.canActivate(ctxFor(req('POST'), OrganizationRole.ADMIN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    findUnique.mockResolvedValue({ role: OrganizationRole.OWNER });
    await expect(guard.canActivate(ctxFor(req('POST'), OrganizationRole.ADMIN))).resolves.toBe(
      true,
    );
  });
});
