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

/** "kpi_analysis" -> "KPI analysis": capability ids in plain words. */
export function humanizeCapability(name: string): string {
  const ACRONYMS = new Set(['kpi', 'a2a', 'llm', 'mcp', 'api', 'sql']);
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const [first, ...rest] = words;
  if (first === undefined) return name;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

export interface RequirementChipGroup {
  label: string;
  chips: string[];
}

/**
 * Groups of short chips describing the context an agent asks for, for the
 * visual agent cards. Empty lists are left out; flags become one chip each.
 */
export function requirementChips(req: AgentContextRequirements | null): RequirementChipGroup[] {
  if (!req) return [];
  const groups: RequirementChipGroup[] = [];
  if (req.dataSourceTypes && req.dataSourceTypes.length > 0) {
    groups.push({ label: 'Sources', chips: req.dataSourceTypes });
  }
  if (req.semanticTypes && req.semanticTypes.length > 0) {
    groups.push({ label: 'Column types', chips: req.semanticTypes });
  }
  if (req.tableKeywords && req.tableKeywords.length > 0) {
    groups.push({ label: 'Tables about', chips: req.tableKeywords });
  }
  const flags: string[] = [];
  if (req.includeHistory) flags.push(`${req.historyDays ?? 30} days of history`);
  if (req.includeUpstream) flags.push('earlier agents’ findings');
  if (req.maxTokens !== undefined) flags.push(`${new Intl.NumberFormat('en-US').format(req.maxTokens)} token budget`);
  if (flags.length > 0) groups.push({ label: 'Also receives', chips: flags });
  return groups;
}
