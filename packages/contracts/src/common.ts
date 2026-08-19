import { z } from 'zod';

export const IdSchema = z.string().uuid();

export const TimestampsSchema = z.object({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * Every value HELIX reports to a user should be traceable back to where it came from.
 * This is the minimal "why should I believe this" unit — attach it to metrics,
 * findings, and recommendations rather than inventing a new ad-hoc shape each time.
 */
export const SourceRefSchema = z.object({
  dataSourceId: IdSchema.optional(),
  agentId: IdSchema.optional(),
  agentTaskId: IdSchema.optional(),
  description: z.string().min(1),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export type Id = z.infer<typeof IdSchema>;
export type Timestamps = z.infer<typeof TimestampsSchema>;
