import { Injectable } from '@nestjs/common';
import type { Investigation } from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deliberately minimal for Phase 0 — proves the API can read/write
 * Investigation rows through Prisma. Full create/plan/delegate flow arrives
 * in Phase 1 (Core Platform) once auth and org scoping are in place.
 */
@Injectable()
export class InvestigationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Explicit return type: emitDecoratorMetadata needs a portable type it can
  // name, and Prisma's inferred payload type isn't one (TS2742).
  findAll(organizationId?: string): Promise<Investigation[]> {
    return this.prisma.investigation.findMany({
      where: organizationId ? { organizationId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
