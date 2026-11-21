import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OrganizationRole, Prisma } from '@helix/database';
import type { TenantContext } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  role: OrganizationRole;
  createdAt: Date;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'org';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the org and makes the creator its OWNER, atomically. */
  async create(userId: string, input: { name: string; slug?: string }): Promise<OrganizationView> {
    const explicit = input.slug !== undefined;
    let slug = explicit ? input.slug! : slugify(input.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const org = await this.prisma.organization.create({
          data: {
            name: input.name,
            slug,
            members: { create: { userId, role: OrganizationRole.OWNER } },
          },
        });
        return { ...org, role: OrganizationRole.OWNER };
      } catch (err) {
        const taken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!taken) throw err;
        if (explicit) throw new ConflictException('Slug is already taken');
        slug = `${slugify(input.name).slice(0, 40)}-${randomBytes(3).toString('hex')}`;
      }
    }
    throw new ConflictException('Could not allocate a unique slug');
  }

  async listForUser(userId: string): Promise<OrganizationView[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    }));
  }

  async listMembers(organizationId: string): Promise<MemberView[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      createdAt: m.createdAt,
    }));
  }

  async addMember(
    actor: TenantContext,
    input: { email: string; role: OrganizationRole },
  ): Promise<MemberView> {
    this.assertCanAssign(actor, input.role);
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user) throw new NotFoundException('No user with that email; they must sign up first');
    try {
      const m = await this.prisma.organizationMember.create({
        data: { organizationId: actor.organizationId, userId: user.id, role: input.role },
      });
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: m.role,
        createdAt: m.createdAt,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('User is already a member');
      }
      throw err;
    }
  }

  async updateMember(
    actor: TenantContext,
    userId: string,
    role: OrganizationRole,
  ): Promise<MemberView> {
    const target = await this.findMember(actor.organizationId, userId);
    // Granting or revoking OWNER is OWNER-only.
    if (target.role === OrganizationRole.OWNER || role === OrganizationRole.OWNER) {
      this.assertCanAssign(actor, OrganizationRole.OWNER);
    }
    if (target.role === OrganizationRole.OWNER && role !== OrganizationRole.OWNER) {
      await this.assertNotLastOwner(actor.organizationId);
    }
    const m = await this.prisma.organizationMember.update({
      where: { id: target.id },
      data: { role },
      include: { user: { select: { email: true, name: true } } },
    });
    return { userId, email: m.user.email, name: m.user.name, role: m.role, createdAt: m.createdAt };
  }

  async removeMember(actor: TenantContext, userId: string): Promise<void> {
    const target = await this.findMember(actor.organizationId, userId);
    if (target.role === OrganizationRole.OWNER) {
      this.assertCanAssign(actor, OrganizationRole.OWNER);
      await this.assertNotLastOwner(actor.organizationId);
    }
    await this.prisma.organizationMember.delete({ where: { id: target.id } });
  }

  private assertCanAssign(actor: TenantContext, role: OrganizationRole) {
    if (role === OrganizationRole.OWNER && actor.role !== OrganizationRole.OWNER) {
      throw new ForbiddenException('Only an OWNER can grant or revoke the OWNER role');
    }
  }

  private async assertNotLastOwner(organizationId: string) {
    const owners = await this.prisma.organizationMember.count({
      where: { organizationId, role: OrganizationRole.OWNER },
    });
    if (owners <= 1) throw new BadRequestException('An organization must keep at least one OWNER');
  }

  private async findMember(organizationId: string, userId: string) {
    const m = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!m) throw new NotFoundException('Member not found');
    return m;
  }
}
