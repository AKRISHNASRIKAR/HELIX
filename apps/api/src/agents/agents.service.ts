import { Injectable, Logger } from '@nestjs/common';
import { AgentTaskStatus, AgentType } from '@helix/database';
import { AgentRuntimeClient, RuntimeAgent } from '../clients/agent-runtime.client';
import { PrismaService } from '../prisma/prisma.service';

export interface AgentView {
  type: string;
  name: string;
  description: string | null;
  version: string | null;
  status: 'IDLE' | 'BUSY' | 'UNAVAILABLE';
  /** AgentTasks this agent type ran for the organization. */
  tasks: number;
  /** SUCCEEDED / finished tasks (0..1); null until a task has finished. */
  successRate: number | null;
  /** Mean task duration in ms; null until a task has finished. */
  avgMs: number | null;
  capabilities: { name: string; description: string }[];
}

// Shown (as UNAVAILABLE) when the agent runtime can't be reached, so the UI
// still lists the agents that exist in this phase.
const KNOWN_AGENTS: RuntimeAgent[] = [
  { type: AgentType.COORDINATOR, name: 'Coordinator', status: 'UNAVAILABLE', capabilities: [] },
  { type: AgentType.ANALYTICS, name: 'Analytics', status: 'UNAVAILABLE', capabilities: [] },
];

const FINISHED: AgentTaskStatus[] = [
  AgentTaskStatus.SUCCEEDED,
  AgentTaskStatus.FAILED,
  AgentTaskStatus.TIMED_OUT,
];

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AgentRuntimeClient,
  ) {}

  async list(organizationId: string): Promise<AgentView[]> {
    let agents: RuntimeAgent[];
    try {
      const res = await this.runtime.listAgents();
      agents = Array.isArray(res) ? res : [];
    } catch (err) {
      this.logger.warn(`Agent runtime unavailable: ${(err as Error).message}`);
      agents = KNOWN_AGENTS;
    }

    const tasks = await this.prisma.agentTask.findMany({
      where: { investigation: { organizationId } },
      select: { agentType: true, status: true, startedAt: true, completedAt: true },
    });
    const stats = new Map<
      string,
      { tasks: number; finished: number; ok: number; totalMs: number; timed: number }
    >();
    for (const t of tasks) {
      const s = stats.get(t.agentType) ?? { tasks: 0, finished: 0, ok: 0, totalMs: 0, timed: 0 };
      s.tasks++;
      if (FINISHED.includes(t.status)) s.finished++;
      if (t.status === AgentTaskStatus.SUCCEEDED) s.ok++;
      if (t.startedAt && t.completedAt) {
        s.totalMs += t.completedAt.getTime() - t.startedAt.getTime();
        s.timed++;
      }
      stats.set(t.agentType, s);
    }

    return agents.map((a) => {
      const s = stats.get(a.type);
      return {
        type: a.type,
        name: a.name,
        description: a.description ?? null,
        version: a.version ?? null,
        status: a.status,
        tasks: s?.tasks ?? 0,
        successRate: s && s.finished > 0 ? s.ok / s.finished : null,
        avgMs: s && s.timed > 0 ? Math.round(s.totalMs / s.timed) : null,
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
      };
    });
  }
}
