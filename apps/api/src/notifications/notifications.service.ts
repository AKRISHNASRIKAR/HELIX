import { Injectable, NotFoundException } from '@nestjs/common';
import type { Notification } from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateNotification {
  userId: string;
  organizationId?: string | null;
  type: string;
  title: string;
  body: string;
  link?: string | null;
}

/** Per-user in-app notifications. Always filtered by the JWT user, never by input. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotification): Promise<Notification> {
    return this.prisma.notification.create({ data: input });
  }

  /** Sends the same notice to every member of the organization (all roles). Returns how many. */
  async notifyOrganization(
    organizationId: string,
    input: Omit<CreateNotification, 'userId' | 'organizationId'>,
  ): Promise<number> {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    if (members.length === 0) return 0;
    const res = await this.prisma.notification.createMany({
      data: members.map((m) => ({ ...input, userId: m.userId, organizationId })),
    });
    return res.count;
  }

  list(userId: string, unreadOnly: boolean): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      // Either already read (fine) or not this user's notification (404).
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (!exists) throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  /** Unread count, optionally limited to one org (org-less notices always count). */
  unreadCount(userId: string, organizationId?: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        readAt: null,
        ...(organizationId ? { OR: [{ organizationId }, { organizationId: null }] } : {}),
      },
    });
  }
}
