import { z } from 'zod';
import {
  AgentTaskStatus,
  AgentType,
  AnalyticsType,
  AnomalySeverity,
  EvidenceSourceType,
  RecommendationPriority,
} from '@helix/database';

/**
 * Spec D InvestigationRunResult, as returned by agent-runtime
 * `POST /investigations/run`. Validated before anything is persisted so a
 * malformed response fails the investigation cleanly instead of half-writing.
 * Ids are UUIDs generated in Python and stored as-is.
 */
const Id = z.string().uuid();
const Json = z.unknown();
const Ts = z.coerce.date();
const nullableNumber = z
  .number()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const PlanStep = z.object({
  order: z.number().int().nonnegative(),
  agentType: z.string(),
  objective: z.string(),
  dependsOn: z.array(z.number().int()).default([]),
});

export const RunResultSchema = z.object({
  status: z.enum(['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED']),
  plan: z
    .object({ steps: z.array(PlanStep).default([]), reasoning: z.string().nullish() })
    .passthrough()
    .nullish(),
  steps: z
    .array(
      z.object({
        id: Id,
        order: z.number().int().nonnegative(),
        agentType: z.nativeEnum(AgentType),
        objective: z.string(),
        dependsOn: z.array(z.number().int()).default([]),
      }),
    )
    .default([]),
  tasks: z
    .array(
      z.object({
        id: Id,
        stepId: Id.nullish(),
        agentType: z.nativeEnum(AgentType),
        status: z.nativeEnum(AgentTaskStatus),
        objective: z.string(),
        inputContext: Json.optional(),
        result: Json.optional(),
        error: z.string().nullish(),
        startedAt: Ts.nullish(),
        completedAt: Ts.nullish(),
        timeoutMs: z.number().int().positive().nullish(),
      }),
    )
    .default([]),
  evidence: z
    .array(
      z.object({
        id: Id,
        agentTaskId: Id,
        sourceType: z.nativeEnum(EvidenceSourceType),
        source: z.record(z.unknown()).default({ description: 'unspecified' }),
        summary: z.string(),
        data: Json.optional(),
        confidence: z.number().min(0).max(1),
        collectedAt: Ts.nullish(),
      }),
    )
    .default([]),
  findings: z
    .array(
      z.object({
        id: Id,
        agentTaskId: Id.nullish(),
        agentType: z.nativeEnum(AgentType),
        analyticsType: z.nativeEnum(AnalyticsType),
        statement: z.string(),
        confidence: z.number().min(0).max(1),
        isRootCause: z.boolean().default(false),
        evidenceIds: z.array(Id).default([]),
      }),
    )
    .default([]),
  recommendations: z
    .array(
      z.object({
        id: Id,
        title: z.string(),
        description: z.string(),
        priority: z.nativeEnum(RecommendationPriority).default(RecommendationPriority.MEDIUM),
        expectedImpact: z.string().nullish(),
        findingIds: z.array(Id).default([]),
      }),
    )
    .default([]),
  metrics: z
    .array(
      z.object({
        id: Id,
        dataSourceId: Id.nullish(),
        name: z.string(),
        unit: z.string().nullish(),
        value: z.number(),
        baseline: nullableNumber,
        changePercent: nullableNumber,
        series: Json.optional(),
        computationMethod: z.string().min(1),
        computedAt: Ts.nullish(),
      }),
    )
    .default([]),
  anomalies: z
    .array(
      z.object({
        id: Id,
        metricId: Id.nullish(),
        dataSourceId: Id.nullish(),
        description: z.string(),
        severity: z.nativeEnum(AnomalySeverity),
        detectedAt: Ts.nullish(),
        detectionMethod: z.string(),
        value: z.number(),
        expectedValue: nullableNumber,
        deviationScore: nullableNumber,
      }),
    )
    .default([]),
  summary: z.string().nullish(),
  overallConfidence: z.number().nullish(),
  rootCauseFindingId: Id.nullish(),
});
export type RunResult = z.infer<typeof RunResultSchema>;
