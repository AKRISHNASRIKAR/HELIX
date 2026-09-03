import type { Investigation } from '@helix/contracts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ApiHealth {
  status: 'ok' | 'error';
  info?: Record<string, { status: string }>;
}

/** Server-side fetch helper for the API — no client secrets, no business logic here. */
export async function getApiHealth(): Promise<ApiHealth | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ApiHealth;
  } catch {
    return null;
  }
}

/**
 * Lists investigations from `GET /api/v1/investigations` (the one real endpoint
 * today — read-only, org scoping arrives in Phase 1). Returns `[]` when the API
 * is unreachable so pages can render a graceful empty state instead of erroring.
 */
export async function getInvestigations(): Promise<Investigation[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/investigations`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as Investigation[];
  } catch {
    return [];
  }
}

/**
 * Fetches one investigation. There is no `GET /investigations/:id` endpoint yet
 * (Phase 1), so this falls back to filtering the list. Returns `null` when not
 * found or the API is unreachable.
 */
export async function getInvestigation(id: string): Promise<Investigation | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/investigations/${id}`, { cache: 'no-store' });
    if (res.ok) return (await res.json()) as Investigation;
  } catch {
    // fall through to the list-based lookup below
  }

  const all = await getInvestigations();
  return all.find((investigation) => investigation.id === id) ?? null;
}
