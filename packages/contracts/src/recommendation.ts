import { z } from 'zod';
import { RecommendationPriority } from '@helix/types';
import { IdSchema, TimestampsSchema } from './common';

export const RecommendationSchema = z
  .object({
    id: IdSchema,
    investigationId: IdSchema,
    findingIds: z.array(IdSchema).min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.nativeEnum(RecommendationPriority),
    /** Human-readable expected impact of taking this action; not a hard guarantee. */
    expectedImpact: z.string().optional(),
  })
  .merge(TimestampsSchema);
export type Recommendation = z.infer<typeof RecommendationSchema>;
