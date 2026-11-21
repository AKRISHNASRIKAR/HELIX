import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  ipAddress?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best effort: an audit write failure is logged, never surfaced to the caller. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          userId: entry.userId ?? null,
          organizationId: entry.organizationId ?? null,
          ipAddress: entry.ipAddress ?? null,
          metadata: entry.metadata ?? {},
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
