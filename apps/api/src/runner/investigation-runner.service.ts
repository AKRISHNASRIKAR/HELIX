import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DataSourceStatus, InvestigationStatus, Prisma, type Investigation } from '@helix/database';
import { AgentRuntimeClient, RunInvestigationRequest } from '../clients/agent-runtime.client';
import { UpstreamError } from '../clients/http';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RunResult, RunResultSchema } from './run-result.schema';

const TERMINAL = new Set<InvestigationStatus>([
  InvestigationStatus.COMPLETED,
  InvestigationStatus.PARTIALLY_COMPLETED,
  InvestigationStatus.FAILED,
  InvestigationStatus.CANCELLED,
]);

const json = (v: unknown): Prisma.InputJsonValue => (v ?? {}) as Prisma.InputJsonValue;
const nullableJson = (v: unknown) =>
  v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
const clamp01 = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? null : Math.min(1, Math.max(0, v));

/**
 * Investigation runner. Hands a freshly created investigation to the agent
 * runtime's Coordinator, then persists the whole trail (steps, tasks,
 * evidence, findings, recommendations, metrics, anomalies, A2A messages,
 * context snapshots) in one transaction. Runs detached from the HTTP request and never throws: any
 * failure ends as status FAILED with an explanatory summary.
 */
@Injectable()
export class InvestigationRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(InvestigationRunnerService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRuntime: AgentRuntimeClient,
    private readonly notifications: NotificationsService,
  ) {}

  /** Starts a run on the next tick so the creating request returns immediately. */
  enqueue(investigationId: string): void {
    if (this.inFlight.has(investigationId)) return;
    const run = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.run(investigationId))
      .catch((err: Error) =>
        this.logger.error(`Runner crashed for ${investigationId}: ${err.stack ?? err.message}`),
      )
      .finally(() => this.inFlight.delete(investigationId));
    this.inFlight.set(investigationId, run);
  }

  /** Resolves once every queued run has finished (used by tests and shutdown). */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  async onModuleDestroy() {
    await this.whenIdle();
  }

  async run(investigationId: string): Promise<void> {
    const inv = await this.prisma.investigation.findUnique({ where: { id: investigationId } });
    if (!inv || inv.status === InvestigationStatus.CANCELLED) return;

    let raw: unknown;
    try {
      raw = await this.agentRuntime.runInvestigation(await this.buildRequest(inv));
    } catch (err) {
      const reason =
        err instanceof UpstreamError && err.unreachable
          ? `the agent runtime is unreachable (${err.message})`
          : `the agent runtime returned an error (${(err as Error).message})`;
      await this.fail(inv, `Investigation could not run: ${reason}.`);
      return;
    }

    const parsed = RunResultSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      await this.fail(
        inv,
        `Investigation could not run: the agent runtime returned an invalid result (${issues}).`,
      );
      return;
    }

    let cancelled: boolean;
    try {
      cancelled = await this.persist(inv, parsed.data);
    } catch (err) {
      this.logger.error(`Persisting run result failed for ${inv.id}: ${(err as Error).message}`);
      await this.fail(inv, 'Investigation finished but its results could not be stored.');
      return;
    }

    const r = parsed.data;
    const failed = r.status === 'FAILED';
    await this.event(inv.id, failed ? 'investigation.failed' : 'investigation.completed', {
      status: r.status,
      overallConfidence: clamp01(r.overallConfidence),
      rootCauseFindingId: r.rootCauseFindingId ?? null,
      findings: r.findings.length,
      meta: r.meta,
      ...(cancelled ? { cancelled: true } : {}),
    });
    if (!cancelled) {
      const title = failed
        ? 'Investigation failed'
        : r.status === 'PARTIALLY_COMPLETED'
          ? 'Investigation partially completed'
          : 'Investigation completed';
      await this.notify(inv, failed ? 'failed' : 'completed', title, r.summary ?? inv.question);
    }
  }

  // ------------------------------------------------------------------ internals

  private async buildRequest(inv: Investigation): Promise<RunInvestigationRequest> {
    const sources = await this.prisma.dataSource.findMany({
      where: { organizationId: inv.organizationId, status: DataSourceStatus.CONNECTED },
      include: { schemas: { orderBy: { tableName: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      investigation: {
        id: inv.id,
        organizationId: inv.organizationId,
        projectId: inv.projectId,
        question: inv.question,
        triggerType: inv.triggerType,
        triggerContext:
          inv.triggerContext && typeof inv.triggerContext === 'object'
            ? (inv.triggerContext as Record<string, unknown>)
            : null,
      },
      dataSources: sources.map((ds) => ({
        id: ds.id,
        name: ds.name,
        type: ds.type,
        schemas: ds.schemas.map((s) => ({
          tableName: s.tableName,
          columns: Array.isArray(s.columns)
            ? (s.columns as RunInvestigationRequest['dataSources'][number]['schemas'][number]['columns'])
            : [],
          rowCountEstimate: s.rowCountEstimate,
        })),
      })),
    };
  }

  /**
   * Writes the whole result atomically. References the runtime made to ids
   * we don't know (or that belong to another org) are dropped rather than
   * failing the run. Returns true if the investigation was cancelled while
   * running, in which case the trail is kept but the status stays CANCELLED.
   */
  private async persist(inv: Investigation, r: RunResult): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.investigation.findUniqueOrThrow({
          where: { id: inv.id },
          select: { status: true, startedAt: true },
        });
        const cancelled = current.status === InvestigationStatus.CANCELLED;
        const now = new Date();

        const orgSources = await tx.dataSource.findMany({
          where: { organizationId: inv.organizationId },
          select: { id: true },
        });
        const dsIds = new Set(orgSources.map((d) => d.id));
        const ds = (id: string | null | undefined) => (id && dsIds.has(id) ? id : null);

        const stepIds = new Set(r.steps.map((s) => s.id));
        await tx.investigationStep.createMany({
          data: r.steps.map((s) => ({
            id: s.id,
            investigationId: inv.id,
            order: s.order,
            agentType: s.agentType,
            objective: s.objective,
            dependsOn: s.dependsOn,
          })),
        });

        const taskIds = new Set(r.tasks.map((t) => t.id));
        await tx.agentTask.createMany({
          data: r.tasks.map((t) => ({
            id: t.id,
            investigationId: inv.id,
            investigationStepId: t.stepId && stepIds.has(t.stepId) ? t.stepId : null,
            agentType: t.agentType,
            status: t.status,
            objective: t.objective,
            inputContext: json(t.inputContext),
            result: nullableJson(t.result),
            error: t.error ?? null,
            startedAt: t.startedAt ?? null,
            completedAt: t.completedAt ?? null,
            ...(t.timeoutMs ? { timeoutMs: t.timeoutMs } : {}),
          })),
        });

        const metricIds = new Set(r.metrics.map((m) => m.id));
        await tx.metric.createMany({
          data: r.metrics.map((m) => ({
            id: m.id,
            organizationId: inv.organizationId,
            dataSourceId: ds(m.dataSourceId),
            name: m.name,
            unit: m.unit ?? null,
            value: m.value,
            baseline: m.baseline,
            changePercent: m.changePercent,
            series: nullableJson(m.series),
            computationMethod: m.computationMethod,
            computedAt: m.computedAt ?? now,
          })),
        });
        await tx.anomaly.createMany({
          data: r.anomalies.map((a) => ({
            id: a.id,
            organizationId: inv.organizationId,
            metricId: a.metricId && metricIds.has(a.metricId) ? a.metricId : null,
            dataSourceId: ds(a.dataSourceId),
            description: a.description,
            severity: a.severity,
            detectedAt: a.detectedAt ?? now,
            detectionMethod: a.detectionMethod,
            value: a.value,
            expectedValue: a.expectedValue,
            deviationScore: a.deviationScore,
          })),
        });

        // Evidence must hang off a task we persisted (agentTaskId is required).
        const evidence = r.evidence.filter((e) => taskIds.has(e.agentTaskId));
        const evidenceIds = new Set(evidence.map((e) => e.id));
        await tx.evidence.createMany({
          data: evidence.map((e) => ({
            id: e.id,
            investigationId: inv.id,
            agentTaskId: e.agentTaskId,
            sourceType: e.sourceType,
            source: json(e.source),
            summary: e.summary,
            data: json(e.data),
            confidence: e.confidence,
            collectedAt: e.collectedAt ?? now,
          })),
        });

        const findingIds = new Set(r.findings.map((f) => f.id));
        await tx.finding.createMany({
          data: r.findings.map((f) => ({
            id: f.id,
            investigationId: inv.id,
            agentType: f.agentType,
            analyticsType: f.analyticsType,
            statement: f.statement,
            confidence: f.confidence,
            isRootCause: f.isRootCause,
          })),
        });
        await tx.findingEvidence.createMany({
          data: r.findings.flatMap((f) =>
            f.evidenceIds
              .filter((id) => evidenceIds.has(id))
              .map((evidenceId) => ({ findingId: f.id, evidenceId })),
          ),
          skipDuplicates: true,
        });

        await tx.recommendation.createMany({
          data: r.recommendations.map((rec) => ({
            id: rec.id,
            investigationId: inv.id,
            title: rec.title,
            description: rec.description,
            priority: rec.priority,
            expectedImpact: rec.expectedImpact ?? null,
          })),
        });
        await tx.recommendationFinding.createMany({
          data: r.recommendations.flatMap((rec) =>
            rec.findingIds
              .filter((id) => findingIds.has(id))
              .map((findingId) => ({ recommendationId: rec.id, findingId })),
          ),
          skipDuplicates: true,
        });

        // A2A trail and per-task context. Task links are kept only for tasks we
        // persisted; the rows themselves are kept either way.
        const taskRef = (id: string | null | undefined) => (id && taskIds.has(id) ? id : null);
        await tx.agentMessage.createMany({
          data: r.messages.map((m) => ({
            id: m.id,
            investigationId: inv.id,
            agentTaskId: taskRef(m.agentTaskId),
            type: m.type,
            fromAgent: m.fromAgent,
            toAgent: m.toAgent,
            payload: json(m.payload),
            correlationId: m.correlationId,
            createdAt: m.createdAt ?? now,
          })),
          skipDuplicates: true,
        });
        await tx.contextSnapshot.createMany({
          data: r.contextSnapshots.map((c) => ({
            id: c.id,
            investigationId: inv.id,
            agentTaskId: taskRef(c.agentTaskId),
            agentType: c.agentType,
            assembledContext: json(c.assembledContext),
            tokenCount: c.tokenCount ?? null,
            createdAt: c.createdAt ?? now,
          })),
          skipDuplicates: true,
        });

        await tx.investigation.update({
          where: { id: inv.id },
          data: {
            ...(cancelled ? {} : { status: r.status as InvestigationStatus }),
            plan: nullableJson(r.plan),
            summary:
              r.summary ??
              (r.status === 'FAILED' ? 'The investigation failed without a summary.' : null),
            overallConfidence: clamp01(r.overallConfidence),
            rootCauseFindingId:
              r.rootCauseFindingId && findingIds.has(r.rootCauseFindingId)
                ? r.rootCauseFindingId
                : null,
            completedAt: now,
            ...(current.startedAt ? {} : { startedAt: now }),
          },
        });
        return cancelled;
      },
      { timeout: 30_000 },
    );
  }

  /** Marks the investigation FAILED (unless it was cancelled), logs the event, notifies the creator. */
  private async fail(inv: Investigation, summary: string): Promise<void> {
    this.logger.warn(`Investigation ${inv.id} failed: ${summary}`);
    try {
      const now = new Date();
      const res = await this.prisma.investigation.updateMany({
        where: { id: inv.id, status: { notIn: [...TERMINAL] } },
        data: { status: InvestigationStatus.FAILED, summary, completedAt: now },
      });
      await this.prisma.investigation.updateMany({
        where: { id: inv.id, startedAt: null },
        data: { startedAt: now },
      });
      await this.event(inv.id, 'investigation.failed', { status: 'FAILED', reason: summary });
      if (res.count > 0) await this.notify(inv, 'failed', 'Investigation failed', summary);
    } catch (err) {
      this.logger.error(`Could not record failure for ${inv.id}: ${(err as Error).message}`);
    }
  }

  private async event(investigationId: string, type: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.investigationEvent.create({
        data: { investigationId, type, payload: json(payload) },
      });
    } catch (err) {
      this.logger.error(
        `Could not write ${type} event for ${investigationId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The creator gets `investigation.<outcome>`. Investigations nobody created
   * (opened by a monitor) notify every org member with
   * `investigation.autonomous_<outcome>` instead.
   */
  private async notify(
    inv: Investigation,
    outcome: 'completed' | 'failed',
    title: string,
    body: string,
  ) {
    const notice = {
      organizationId: inv.organizationId,
      body: body.length > 500 ? `${body.slice(0, 497)}...` : body,
      link: `/investigations/${inv.id}`,
    };
    try {
      if (inv.createdByUserId) {
        await this.notifications.create({
          ...notice,
          userId: inv.createdByUserId,
          type: `investigation.${outcome}`,
          title,
        });
      } else {
        await this.notifications.notifyOrganization(inv.organizationId, {
          ...notice,
          type: `investigation.autonomous_${outcome}`,
          title: `Autonomous ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
        });
      }
    } catch (err) {
      this.logger.error(`Could not notify for ${inv.id}: ${(err as Error).message}`);
    }
  }
}
