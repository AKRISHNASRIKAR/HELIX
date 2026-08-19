import { z } from 'zod';
import { InvestigationStatus, InvestigationTriggerType } from '@helix/types';
import { IdSchema, TimestampsSchema } from './common';

/**
 * The Coordinator's plan for how to answer the investigation's question —
 * which agent types to delegate to and in what order/parallelism.
 */
export const InvestigationPlanStepSchema = z.object({
  order: z.number().int().nonnegative(),
  agentType: z.string(),
  objective: z.string().min(1),
  dependsOn: z.array(z.number().int().nonnegative()).default([]),
});

export const InvestigationPlanSchema = z.object({
  steps: z.array(InvestigationPlanStepSchema),
  reasoning: z.string().optional(),
});
export type InvestigationPlan = z.infer<typeof InvestigationPlanSchema>;

/**
 * Investigation is the central domain concept in HELIX (see section 13 of the
 * project brief). Everything else — agent tasks, evidence, findings,
 * recommendations — hangs off an investigationId.
 */
export const InvestigationSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    projectId: IdSchema,
    createdByUserId: IdSchema.nullable(),
    triggerType: z.nativeEnum(InvestigationTriggerType),
    question: z.string().min(1),
    status: z.nativeEnum(InvestigationStatus),
    plan: InvestigationPlanSchema.nullable(),
    rootCauseFindingId: IdSchema.nullable(),
    summary: z.string().nullable(),
    overallConfidence: z.number().min(0).max(1).nullable(),
    startedAt: z.coerce.date().nullable(),
    completedAt: z.coerce.date().nullable(),
  })
  .merge(TimestampsSchema);
export type Investigation = z.infer<typeof InvestigationSchema>;

export const CreateInvestigationSchema = z.object({
  organizationId: IdSchema,
  projectId: IdSchema,
  question: z.string().min(1),
  triggerType: z.nativeEnum(InvestigationTriggerType).default(InvestigationTriggerType.USER_QUESTION),
});
export type CreateInvestigation = z.infer<typeof CreateInvestigationSchema>;
