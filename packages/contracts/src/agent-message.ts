import { z } from 'zod';
import { AgentMessageType, AgentType } from '@helix/types';
import { IdSchema } from './common';

/**
 * Transport-agnostic envelope for agent-to-agent (A2A) communication.
 * This is the internal abstraction referenced in docs/architecture/a2a.md —
 * today it travels over HTTP/Redis pub-sub via services/a2a-gateway; a formal
 * A2A protocol can replace the transport later without changing this shape.
 */
export const AgentMessageSchema = z.object({
  id: IdSchema,
  type: z.nativeEnum(AgentMessageType),
  investigationId: IdSchema,
  agentTaskId: IdSchema.optional(),
  fromAgent: z.nativeEnum(AgentType),
  toAgent: z.nativeEnum(AgentType).or(z.literal('COORDINATOR')),
  payload: z.record(z.string(), z.unknown()),
  correlationId: IdSchema,
  createdAt: z.coerce.date(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
