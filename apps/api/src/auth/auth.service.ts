import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import type { OrganizationRole } from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser, toPublicUser, UsersService } from '../users/users.service';
import type { JwtPayload } from './jwt.strategy';

export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

export interface MeResult {
  user: PublicUser;
  memberships: {
    organizationId: string;
    organizationName: string;
    slug: string;
    role: OrganizationRole;
  }[];
}

// Verified against a throwaway hash when the email is unknown so login timing
// doesn't reveal which emails are registered.
const DUMMY_HASH_INPUT = 'helix-timing-equalizer';

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async signup(input: { email: string; name: string; password: string }): Promise<AuthResult> {
    if (await this.users.findByEmail(input.email)) {
      throw new ConflictException('Email is already registered');
    }
    const user = await this.users.create({
      email: input.email,
      name: input.name,
      passwordHash: await hash(input.password),
    });
    return this.issue(user);
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      this.dummyHash ??= hash(DUMMY_HASH_INPUT);
      await verify(await this.dummyHash, input.password);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issue(user);
  }

  async me(userId: string): Promise<MeResult> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user: toPublicUser(user),
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
    };
  }

  private async issue(user: PublicUser): Promise<AuthResult> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return { accessToken: await this.jwt.signAsync(payload), user: toPublicUser(user) };
  }
}
