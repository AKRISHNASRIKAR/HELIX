import { z } from 'zod';
import { EvidenceSourceType } from '@helix/types';
import { IdSchema, SourceRefSchema, TimestampsSchema } from './common';

/**
 * A single, citable piece of support for a finding. Every Evidence record must
 * be traceable to a concrete computation or record — see docs/architecture
 * /analytics-engine.md and section 15 (Confidence and Evidence) of the project brief.
 */
export const EvidenceSchema = z
  .object({
    id: IdSchema,
    investigationId: IdSchema,
    agentTaskId: IdSchema,
    sourceType: z.nativeEnum(EvidenceSourceType),
    source: SourceRefSchema,
    summary: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
    confidence: z.number().min(0).max(1),
    collectedAt: z.coerce.date(),
  })
  .merge(TimestampsSchema);
export type Evidence = z.infer<typeof EvidenceSchema>;
