import type { InvestigationDetail } from '../../lib/api';

/**
 * Pulls the "why" out of a completed investigation for the dashboard story
 * strip. Prefers the clause of the root cause that names what changed (for
 * example "the web-checkout v2.14.0 deploy at 08:40 UTC"), then the most
 * confident non-analytics finding, then the root cause statement itself.
 */
export function storyWhy(inv: Pick<InvestigationDetail, 'findings' | 'summary'>): string | null {
  const findings = inv.findings ?? [];
  const root = findings.find((f) => f.isRootCause)?.statement ?? inv.summary ?? '';
  const after = /(?:shortly |right |just )?after (?:the )?([^,;()]*?(?:deploy|release|migration|change|outage|incident)[^,;()]*)/i.exec(root);
  if (after?.[1]) return capitalize(`${after[1].trim()}`);
  const because = /because ([^,;(]+)/i.exec(root);
  const other = findings
    .filter((f) => !f.isRootCause && f.agentType !== 'ANALYTICS' && f.agentType !== 'COORDINATOR')
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (other) return firstClause(other.statement);
  if (because?.[1]) return capitalize(because[1].trim());
  return root ? firstClause(root) : null;
}

/** "because ..." part of the root cause, if any (e.g. "web orders collapsed"). */
export function storyBecause(inv: Pick<InvestigationDetail, 'findings' | 'summary'>): string | null {
  const root = (inv.findings ?? []).find((f) => f.isRootCause)?.statement ?? inv.summary ?? '';
  const m = /because ([^,;(]+)/i.exec(root);
  return m?.[1] ? capitalize(m[1].trim()) : null;
}

function firstClause(s: string) {
  const cut = s.split(/(?<=[.;])\s|,\s(?=which|while|and )/)[0] ?? s;
  return cut.length > 140 ? `${cut.slice(0, 137).trimEnd()}...` : cut;
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
