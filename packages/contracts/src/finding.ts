import { z } from 'zod';
import { AgentType, AnalyticsType } from '@helix/types';
import { IdSchema, TimestampsSchema } from './common';

/**
 * A conclusion an agent draws from one or more pieces of Evidence.
 * Findings are what the Coordinator assembles into the final investigation
 * narrative — the LLM interprets findings, it does not invent them.
 */
export const FindingSchema = z
  .object({
    id: IdSchema,
    investigationId: IdSchema,
    agentType: z.nativeEnum(AgentType),
    analyticsType: z.nativeEnum(AnalyticsType),
    statement: z.string().min(1),
    evidenceIds: z.array(IdSchema).min(1),
    confidence: z.number().min(0).max(1),
    isRootCause: z.boolean().default(false),
  })
  .merge(TimestampsSchema);
export type Finding = z.infer<typeof FindingSchema>;
