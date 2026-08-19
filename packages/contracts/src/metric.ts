import { z } from 'zod';
import { IdSchema, TimestampsSchema } from './common';

export const MetricDataPointSchema = z.object({
  timestamp: z.coerce.date(),
  value: z.number(),
});

/**
 * A named, time-series-capable measurement produced by the analytics engine.
 * Metrics are always the output of an actual computation (pandas/numpy/SQL) —
 * never an LLM guess. See docs/architecture/analytics-engine.md.
 */
export const MetricSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    dataSourceId: IdSchema.optional(),
    name: z.string().min(1),
    unit: z.string().optional(),
    value: z.number(),
    baseline: z.number().optional(),
    changePercent: z.number().optional(),
    series: z.array(MetricDataPointSchema).optional(),
    computedAt: z.coerce.date(),
    computationMethod: z.string().min(1),
  })
  .merge(TimestampsSchema);
export type Metric = z.infer<typeof MetricSchema>;
