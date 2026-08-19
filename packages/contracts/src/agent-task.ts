import { z } from 'zod';
import { AgentTaskStatus, AgentType } from '@helix/types';
import { IdSchema, TimestampsSchema } from './common';

/**
 * A unit of work the Coordinator delegates to one agent within an investigation.
 * Mirrors AgentTask in packages/database/prisma/schema.prisma.
 */
export const AgentTaskSchema = z
  .object({
    id: IdSchema,
    investigationId: IdSchema,
    agentType: z.nativeEnum(AgentType),
    agentId: IdSchema.optional(),
    status: z.nativeEnum(AgentTaskStatus),
    objective: z.string().min(1),
    /** Context assembled by the Context Engine for this specific task. */
    inputContext: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    startedAt: z.coerce.date().nullable(),
    completedAt: z.coerce.date().nullable(),
    timeoutMs: z.number().int().positive().default(60_000),
  })
  .merge(TimestampsSchema);
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const CreateAgentTaskSchema = AgentTaskSchema.pick({
  investigationId: true,
  agentType: true,
  objective: true,
  inputContext: true,
}).extend({
  timeoutMs: AgentTaskSchema.shape.timeoutMs.optional(),
});
export type CreateAgentTask = z.infer<typeof CreateAgentTaskSchema>;
