import type { AgentContextRequirements, AgentSummary } from './api';

/** Pure helpers for the agent registry page (tested in lib/agents.test.ts). */

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Accepts camelCase (API) or snake_case (raw runtime) requirement objects. */
export function normalizeContextRequirements(raw: unknown): AgentContextRequirements | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string) => (r[camel] !== undefined ? r[camel] : r[snake]);
  const dsTypes = pick('dataSourceTypes', 'data_source_types');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  return {
    semanticTypes: list(pick('semanticTypes', 'semantic_types')),
    tableKeywords: list(pick('tableKeywords', 'table_keywords')),
    dataSourceTypes: Array.isArray(dsTypes) ? dsTypes.map(String) : null,
    includeHistory: bool(pick('includeHistory', 'include_history')),
    historyDays: num(pick('historyDays', 'history_days')),
    includeUpstream: bool(pick('includeUpstream', 'include_upstream')),
    maxTokens: num(pick('maxTokens', 'max_tokens')),
  };
}

/** Label/value rows describing what context an agent receives. */
export function requirementRows(req: AgentContextRequirements | null): { label: string; value: string }[] {
  if (!req) return [];
  const join = (v: string[] | null | undefined, empty: string) => (v && v.length > 0 ? v.join(', ') : empty);
  const rows = [
    { label: 'Data source types', value: join(req.dataSourceTypes, 'any') },
    { label: 'Semantic types', value: join(req.semanticTypes, 'any') },
    { label: 'Table keywords', value: join(req.tableKeywords, 'none') },
  ];
  if (req.includeHistory !== undefined) {
    rows.push({
      label: 'History',
      value: req.includeHistory ? `last ${req.historyDays ?? 30} days` : 'not included',
    });
  }
  if (req.includeUpstream !== undefined) {
    rows.push({ label: 'Upstream results', value: req.includeUpstream ? 'included' : 'not included' });
  }
  if (req.maxTokens !== undefined) {
    rows.push({ label: 'Token budget', value: new Intl.NumberFormat('en-US').format(req.maxTokens) });
  }
  return rows;
}

const ORDER = ['COORDINATOR', 'ANALYTICS', 'FINANCE', 'CUSTOMER', 'PRODUCT'];

/** Coordinator first, then the domain agents in plan order, then the rest by name. */
export function sortAgents<T extends Pick<AgentSummary, 'type' | 'name'>>(agents: T[]): T[] {
  const rank = (t: string) => {
    const i = ORDER.indexOf(t);
    return i === -1 ? ORDER.length : i;
  };
  return [...agents].sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));
}
