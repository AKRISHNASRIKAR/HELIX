import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiHealth, getInvestigation, getInvestigations } from './api';

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

describe('getApiHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed health payload on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      }),
    );

    await expect(getApiHealth()).resolves.toEqual({ status: 'ok' });
  });

  it('returns null when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );

    await expect(getApiHealth()).resolves.toBeNull();
  });

  it('returns null on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(getApiHealth()).resolves.toBeNull();
  });
});

describe('getInvestigations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [investigation] }),
    );

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the record from the detail endpoint when it exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => investigation }),
    );

    await expect(getInvestigation('inv-1')).resolves.toEqual(investigation);
  });

  it('falls back to the list when the detail endpoint 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => [investigation] }),
    );

    await expect(getInvestigation('inv-1')).resolves.toEqual(investigation);
  });

  it('returns null when the id is not found anywhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => [investigation] }),
    );

    await expect(getInvestigation('missing')).resolves.toBeNull();
  });
});
