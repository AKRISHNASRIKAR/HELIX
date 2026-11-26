import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InvestigationStatus,
  InvestigationTriggerType,
  Prisma,
  type Investigation,
} from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';
import { InvestigationRunnerService } from '../runner/investigation-runner.service';
import { buildTrace, InvestigationTrace, runMeta } from './trace';

/** Statuses from which a user may still cancel. */
export const CANCELLABLE: InvestigationStatus[] = [
  InvestigationStatus.PENDING,
  InvestigationStatus.PLANNING,
  InvestigationStatus.IN_PROGRESS,
  InvestigationStatus.AWAITING_EVIDENCE,
];
const TERMINAL: InvestigationStatus[] = [
  InvestigationStatus.COMPLETED,
  InvestigationStatus.PARTIALLY_COMPLETED,
  InvestigationStatus.FAILED,
  InvestigationStatus.CANCELLED,
];

/** GET /investigations/:id: the contract Investigation plus its full trail. */
export type InvestigationDetail = Investigation & {
  /** The monitor that opened it (ANOMALY_DETECTED), else null. */
  monitor: { id: string; name: string } | null;
  /** Run metadata from the agent runtime (planner, summary writer, LLM usage); {} before a run. */
  meta: Record<string, unknown>;
  steps: {
    id: string;
    order: number;
    agentType: string;
    objective: string;
    dependsOn: unknown;
    createdAt: Date;
  }[];
  tasks: {
    id: string;
    agentType: string;
    status: string;
    objective: string;
    error: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    investigationStepId: string | null;
  }[];
  findings: {
    id: string;
    agentType: string;
    analyticsType: string;
    statement: string;
    confidence: number;
    isRootCause: boolean;
    evidence: string[];
    evidenceItems: {
      id: string;
      sourceType: string;
      summary: string;
      confidence: number;
      data: unknown;
    }[];
  }[];
  recommendations: {
    id: string;
    title: string;
    action: string;
    description: string;
    priority: string;
    expectedImpact: string | null;
  }[];
  events: { id: string; type: string; payload: unknown; createdAt: Date }[];
};

@Injectable()
export class InvestigationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: InvestigationRunnerService,
  ) {}

  // Explicit return type: emitDecoratorMetadata needs a portable type it can
  // name, and Prisma's inferred payload type isn't one (TS2742).
  findAll(
    organizationId: string,
    filter: {
      projectId?: string;
      status?: InvestigationStatus;
      triggerType?: InvestigationTriggerType;
    } = {},
  ): Promise<Investigation[]> {
    return this.prisma.investigation.findMany({
      where: { organizationId, ...filter },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Creates a PENDING investigation and hands it to the runner (async). */
  async create(
    organizationId: string,
    userId: string,
    input: { projectId: string; question: string },
  ): Promise<Investigation> {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, organizationId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const inv = await this.prisma.investigation.create({
      data: {
        organizationId,
        projectId: project.id,
        createdByUserId: userId,
        question: input.question,
        triggerType: InvestigationTriggerType.USER_QUESTION,
        events: {
          create: {
            type: 'investigation.created',
            payload: { question: input.question, createdByUserId: userId },
          },
        },
      },
    });
    this.runner.enqueue(inv.id);
    return inv;
  }

  async detail(organizationId: string, id: string): Promise<InvestigationDetail> {
    const inv = await this.prisma.investigation.findFirst({
      where: { id, organizationId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        agentTasks: { orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }] },
        findings: {
          orderBy: [{ isRootCause: 'desc' }, { confidence: 'desc' }],
          include: { evidenceLinks: { include: { evidence: true } } },
        },
        recommendations: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        monitor: { select: { id: true, name: true } },
      },
    });
    if (!inv) throw new NotFoundException('Investigation not found');

    const { steps, agentTasks, findings, recommendations, events, ...base } = inv;
    return {
      ...base,
      meta: runMeta(events),
      steps: steps.map((s) => ({
        id: s.id,
        order: s.order,
        agentType: s.agentType,
        objective: s.objective,
        dependsOn: s.dependsOn,
        createdAt: s.createdAt,
      })),
      tasks: agentTasks.map((t) => ({
        id: t.id,
        agentType: t.agentType,
        status: t.status,
        objective: t.objective,
        error: t.error,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        investigationStepId: t.investigationStepId,
      })),
      findings: findings.map((f) => {
        const ev = f.evidenceLinks.map((l) => l.evidence);
        return {
          id: f.id,
          agentType: f.agentType,
          analyticsType: f.analyticsType,
          statement: f.statement,
          confidence: f.confidence,
          isRootCause: f.isRootCause,
          evidence: ev.map((e) => e.summary),
          evidenceItems: ev.map((e) => ({
            id: e.id,
            sourceType: e.sourceType,
            summary: e.summary,
            confidence: e.confidence,
            data: e.data,
          })),
        };
      }),
      recommendations: recommendations.map((r) => ({
        id: r.id,
        title: r.title,
        action: r.title,
        description: r.description,
        priority: r.priority,
        expectedImpact: r.expectedImpact,
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        createdAt: e.createdAt,
      })),
    };
  }

  /** Phase 10: the full agent/context trail of one investigation plus its evidence graph. */
  async trace(organizationId: string, id: string): Promise<InvestigationTrace> {
    const inv = await this.prisma.investigation.findFirst({
      where: { id, organizationId },
      include: {
        monitor: { select: { id: true, name: true } },
        steps: { orderBy: { order: 'asc' } },
        agentTasks: { orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }] },
        evidence: { orderBy: [{ collectedAt: 'asc' }, { createdAt: 'asc' }] },
        findings: {
          orderBy: [{ isRootCause: 'desc' }, { confidence: 'desc' }],
          include: { evidenceLinks: { select: { evidenceId: true } } },
        },
        recommendations: {
          orderBy: { createdAt: 'asc' },
          include: { findingLinks: { select: { findingId: true } } },
        },
        agentMessages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        contextSnapshots: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!inv) throw new NotFoundException('Investigation not found');

    return buildTrace({
      investigation: inv,
      steps: inv.steps,
      tasks: inv.agentTasks,
      evidence: inv.evidence,
      findings: inv.findings.map((f) => ({
        id: f.id,
        agentType: f.agentType,
        analyticsType: f.analyticsType,
        statement: f.statement,
        confidence: f.confidence,
        isRootCause: f.isRootCause,
        evidenceIds: f.evidenceLinks.map((l) => l.evidenceId),
      })),
      recommendations: inv.recommendations.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        priority: r.priority,
        expectedImpact: r.expectedImpact,
        findingIds: r.findingLinks.map((l) => l.findingId),
      })),
      messages: inv.agentMessages.map((m) => ({
        id: m.id,
        type: m.type,
        agentTaskId: m.agentTaskId,
        fromAgent: m.fromAgent,
        toAgent: m.toAgent,
        payload: m.payload,
        correlationId: m.correlationId,
        createdAt: m.createdAt,
      })),
      contextSnapshots: inv.contextSnapshots.map((c) => ({
        id: c.id,
        agentTaskId: c.agentTaskId,
        agentType: c.agentType,
        tokenCount: c.tokenCount,
        createdAt: c.createdAt,
        assembledContext: c.assembledContext,
      })),
      events: inv.events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        createdAt: e.createdAt,
      })),
    });
  }

  async cancel(organizationId: string, id: string, userId: string): Promise<Investigation> {
    const inv = await this.prisma.investigation.findFirst({ where: { id, organizationId } });
    if (!inv) throw new NotFoundException('Investigation not found');
    // Conditional update so a run finishing concurrently can't be overwritten.
    const res = await this.prisma.investigation.updateMany({
      where: { id, status: { in: CANCELLABLE } },
      data: { status: InvestigationStatus.CANCELLED, completedAt: new Date() },
    });
    if (res.count === 0) {
      throw new ConflictException(`Investigation is ${inv.status} and can no longer be cancelled`);
    }
    await this.prisma.investigationEvent.create({
      data: {
        investigationId: id,
        type: 'investigation.cancelled',
        payload: { cancelledByUserId: userId },
      },
    });
    return this.prisma.investigation.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Spec A2: progress callback from the agent runtime. Appends the event and
   * applies the status, unless the investigation already reached a terminal
   * state (e.g. the user cancelled it meanwhile).
   */
  async recordProgress(
    id: string,
    input: {
      status?: InvestigationStatus;
      event?: { type: string; payload?: Record<string, unknown>; at?: Date };
    },
  ): Promise<void> {
    const inv = await this.prisma.investigation.findUnique({ where: { id }, select: { id: true } });
    if (!inv) throw new NotFoundException('Investigation not found');

    if (input.status) {
      const data: Prisma.InvestigationUpdateManyMutationInput = { status: input.status };
      await this.prisma.investigation.updateMany({
        where: { id, status: { notIn: TERMINAL } },
        data,
      });
      if (input.status === InvestigationStatus.IN_PROGRESS) {
        await this.prisma.investigation.updateMany({
          where: { id, startedAt: null },
          data: { startedAt: new Date() },
        });
      }
    }
    if (input.event) {
      await this.prisma.investigationEvent.create({
        data: {
          investigationId: id,
          type: input.event.type,
          payload: (input.event.payload ?? {}) as Prisma.InputJsonObject,
          ...(input.event.at ? { createdAt: input.event.at } : {}),
        },
      });
    }
  }
}
