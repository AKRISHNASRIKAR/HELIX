import { z } from 'zod';
import { AgentStatus, AgentType } from '@helix/types';
import { IdSchema, TimestampsSchema } from './common';

/**
 * Static description of what an agent can do — used by the Coordinator to decide
 * who to delegate to, and by the Agent Registry UI. Every agent implementation
 * (Python, agents/<name>) must publish one of these at startup.
 */
export const AgentCapabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const AgentSchema = z
  .object({
    id: IdSchema,
    type: z.nativeEnum(AgentType),
    name: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    status: z.nativeEnum(AgentStatus),
    capabilities: z.array(AgentCapabilitySchema),
    /** Base URL or queue name the agent runtime uses to reach this agent. */
    endpoint: z.string().min(1),
  })
  .merge(TimestampsSchema);
export type Agent = z.infer<typeof AgentSchema>;
