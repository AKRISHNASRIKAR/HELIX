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
