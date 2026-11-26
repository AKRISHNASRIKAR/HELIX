import { Injectable } from '@nestjs/common';
import { InvestigationStatus } from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';

export interface HistoryQuery {
  dataSourceIds?: string[];
  sinceDays: number;
  excludeInvestigationId?: string;
  limit: number;
}

export interface OrganizationHistory {
  metrics: {
    id: string;
    name: string;
    unit: string | null;
    value: number;
    baseline: number | null;
    changePercent: number | null;
    computedAt: Date;
    dataSourceId: string | null;
  }[];
  anomalies: {
    id: string;
    description: string;
    severity: string;
    detectedAt: Date;
    value: number;
    expectedValue: number | null;
    deviationScore: number | null;
    detectionMethod: string;
    dataSourceId: string | null;
  }[];
  findings: {
    id: string;
    investigationId: string;
    statement: string;
    confidence: number;
    isRootCause: boolean;
    agentType: string;
    createdAt: Date;
  }[];
}

const FINISHED: InvestigationStatus[] = [
  InvestigationStatus.COMPLETED,
  InvestigationStatus.PARTIALLY_COMPLETED,
];

/**
 * Spec 9.4: an organization's recent history for the context engine (metrics,
 * anomalies, findings of finished investigations), newest first.
 */
@Injectable()
export class InternalContextService {
  constructor(private readonly prisma: PrismaService) {}

  async history(organizationId: string, q: HistoryQuery): Promise<OrganizationHistory> {
    const since = new Date(Date.now() - q.sinceDays * 86_400_000);
    const sourceFilter = q.dataSourceIds?.length ? { dataSourceId: { in: q.dataSourceIds } } : {};
    const [metrics, anomalies, findings] = await Promise.all([
      this.prisma.metric.findMany({
        where: { organizationId, createdAt: { gte: since }, ...sourceFilter },
        select: {
          id: true,
          name: true,
          unit: true,
          value: true,
          baseline: true,
          changePercent: true,
          computedAt: true,
          dataSourceId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
      this.prisma.anomaly.findMany({
        where: { organizationId, createdAt: { gte: since }, ...sourceFilter },
        select: {
          id: true,
          description: true,
          severity: true,
          detectedAt: true,
          value: true,
          expectedValue: true,
          deviationScore: true,
          detectionMethod: true,
          dataSourceId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
      this.prisma.finding.findMany({
        where: {
          createdAt: { gte: since },
          investigation: {
            organizationId,
            status: { in: FINISHED },
            ...(q.excludeInvestigationId ? { id: { not: q.excludeInvestigationId } } : {}),
          },
        },
        select: {
          id: true,
          investigationId: true,
          statement: true,
          confidence: true,
          isRootCause: true,
          agentType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
    ]);
    return { metrics, anomalies, findings };
  }
}
