import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// next/headers and next/navigation only work inside a Next request; stub them.
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
  }),
}));
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }));

import {
  apiRequest,
  buildHeaders,
  extractErrorMessage,
  getApiHealth,
  getInvestigation,
  getInvestigations,
  getMe,
  normalizeMember,
} from './api';

const investigation = {
  id: 'inv-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  createdByUserId: null,
  triggerType: 'USER_QUESTION',
  question: 'Why did signups drop?',
  status: 'PENDING',
  plan: null,
  rootCauseFindingId: null,
  summary: null,
  overallConfidence: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function lastHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Headers {
  return fetchMock.mock.calls[call]![1].headers as Headers;
}

beforeEach(() => {
  cookieJar.clear();
  redirectMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('buildHeaders', () => {
  it('attaches bearer token and organization id when present', () => {
    const h = buildHeaders({ token: 'tok', organizationId: 'org-1' }, { Accept: 'application/json' });
    expect(h.get('Authorization')).toBe('Bearer tok');
    expect(h.get('X-Organization-Id')).toBe('org-1');
    expect(h.get('Accept')).toBe('application/json');
  });

  it('omits auth headers for an anonymous context', () => {
    const h = buildHeaders({});
    expect(h.has('Authorization')).toBe(false);
    expect(h.has('X-Organization-Id')).toBe(false);
  });
});

describe('apiRequest', () => {
  it('reads the session cookies and sends them as headers', async () => {
    cookieJar.set('helix_token', 'jwt-123');
    cookieJar.set('helix_org', 'org-9');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/projects')).resolves.toEqual({ ok: true, status: 200, data: { a: 1 } });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:4000/api/v1/projects');
    expect(lastHeaders(fetchMock).get('Authorization')).toBe('Bearer jwt-123');
    expect(lastHeaders(fetchMock).get('X-Organization-Id')).toBe('org-9');
  });

  it('serializes json bodies with a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/investigations', { method: 'POST', json: { question: 'q' }, context: {} });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"question":"q"}');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('returns a readable error from a Nest error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ statusCode: 400, message: ['name should not be empty'], error: 'Bad Request' }),
      }),
    );
    await expect(apiRequest('/projects', { context: {} })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'name should not be empty',
    });
  });

  it('reports network failures without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const res = await apiRequest('/projects', { context: {} });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ status: 0 });
  });

  it('redirects to the session-expired handler on 401 for a signed-in user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(apiRequest('/projects', { context: { token: 'stale' } })).rejects.toThrow(
      'NEXT_REDIRECT:/session/expired',
    );
  });

  it('does not redirect on 401 when opted out (e.g. bad login)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Invalid credentials' }) }),
    );
    await expect(
      apiRequest('/auth/login', { context: { token: 'x' }, redirectOn401: false }),
    ).resolves.toMatchObject({ ok: false, status: 401, error: 'Invalid credentials' });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('never redirects in demo mode', async () => {
    vi.stubEnv('HELIX_DEMO', '1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(apiRequest('/projects', { context: { token: 't' } })).resolves.toMatchObject({ ok: false });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('extractErrorMessage', () => {
  it('handles string messages, FastAPI detail and status fallbacks', () => {
    expect(extractErrorMessage({ message: 'Email taken' }, 409)).toBe('Email taken');
    expect(extractErrorMessage({ detail: 'unknown table' }, 422)).toBe('unknown table');
    expect(extractErrorMessage(null, 403)).toBe('You do not have permission to do that.');
    expect(extractErrorMessage(null, 0)).toMatch(/Could not reach/);
    expect(extractErrorMessage(null, 500)).toBe('Request failed (HTTP 500).');
  });
});

describe('getMe', () => {
  it('returns null without a session token (no request made)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getMe()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send the org header to /auth/me', async () => {
    cookieJar.set('helix_token', 'jwt');
    cookieJar.set('helix_org', 'org-1');
    const me = { user: { id: 'u', email: 'a@b.c', name: 'A' }, memberships: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => me });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getMe()).resolves.toEqual(me);
    expect(lastHeaders(fetchMock).get('Authorization')).toBe('Bearer jwt');
    expect(lastHeaders(fetchMock).has('X-Organization-Id')).toBe(false);
  });

  it('returns null in demo mode', async () => {
    vi.stubEnv('HELIX_DEMO', '1');
    cookieJar.set('helix_token', 'jwt');
    await expect(getMe()).resolves.toBeNull();
  });
});

describe('normalizeMember', () => {
  it('accepts flat and nested member shapes', () => {
    expect(normalizeMember({ userId: 'u1', email: 'a@x.io', name: 'A', role: 'ADMIN' })).toEqual({
      userId: 'u1',
      email: 'a@x.io',
      name: 'A',
      role: 'ADMIN',
    });
    expect(normalizeMember({ role: 'VIEWER', user: { id: 'u2', email: 'b@x.io', name: 'B' } })).toEqual({
      userId: 'u2',
      email: 'b@x.io',
      name: 'B',
      role: 'VIEWER',
    });
    expect(normalizeMember({ role: 'VIEWER' })).toBeNull();
  });
});

describe('getApiHealth', () => {
  it('returns the parsed health payload on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }));
    await expect(getApiHealth()).resolves.toEqual({ status: 'ok' });
  });

  it('returns null when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(getApiHealth()).resolves.toBeNull();
  });

  it('returns null on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(getApiHealth()).resolves.toBeNull();
  });
});

describe('getInvestigations', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [investigation] }));
    await expect(getInvestigations()).resolves.toEqual([investigation]);
  });

  it('returns an empty array when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(getInvestigations()).resolves.toEqual([]);
  });

  it('returns an empty array on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(getInvestigations()).resolves.toEqual([]);
  });
});

describe('getInvestigation', () => {
  it('returns the record from the detail endpoint when it exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => investigation }));
    await expect(getInvestigation('inv-1')).resolves.toEqual(investigation);
  });

  it('falls back to the list when the detail endpoint 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => [investigation] }),
    );
    await expect(getInvestigation('inv-1')).resolves.toEqual(investigation);
  });

  it('returns null when the id is not found anywhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => [investigation] }),
    );
    await expect(getInvestigation('missing')).resolves.toBeNull();
  });
});
