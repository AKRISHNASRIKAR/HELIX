import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiHealth } from './api';

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
