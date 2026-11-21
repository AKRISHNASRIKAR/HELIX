/**
 * Minimal JSON-over-fetch helper for service-to-service calls. Every call has
 * a hard timeout and carries the shared internal token.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    /** HTTP status from the upstream, or null when it could not be reached at all. */
    readonly status: number | null,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }

  get unreachable(): boolean {
    return this.status === null;
  }
}

export async function requestJson<T>(
  url: string,
  body: unknown,
  opts: { timeoutMs: number; token: string; method?: 'GET' | 'POST' },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-helix-internal-token': opts.token,
      },
      body: opts.method === 'GET' ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    const reason = e.name === 'TimeoutError' ? `timed out after ${opts.timeoutMs}ms` : e.message;
    throw new UpstreamError(`${new URL(url).origin} unreachable: ${reason}`, null);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? (parsed as { detail: unknown }).detail
        : parsed;
    const message = typeof detail === 'string' ? detail : `upstream responded ${res.status}`;
    throw new UpstreamError(message, res.status, detail);
  }
  return parsed as T;
}
