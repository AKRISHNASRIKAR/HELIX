import { Injectable } from '@nestjs/common';
import type { User } from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export const toPublicUser = (u: Pick<User, 'id' | 'email' | 'name'>): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
});

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: { email: string; name: string; passwordHash: string }): Promise<User> {
    return this.prisma.user.create({ data: { ...data, email: data.email.toLowerCase() } });
  }
}
