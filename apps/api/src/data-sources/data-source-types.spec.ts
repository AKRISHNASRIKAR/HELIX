import { CreateDataSourceSchema, validateUpdate } from './data-source-types';

describe('CreateDataSourceSchema', () => {
  it('defaults a missing type to POSTGRESQL (Phase 2 clients)', () => {
    const res = CreateDataSourceSchema.parse({
      name: 'warehouse',
      config: { host: 'h', database: 'd' },
      credentials: { user: 'u', password: 'p' },
    });
    expect(res).toMatchObject({ type: 'POSTGRESQL', config: { port: 5432 } });
  });

  it('accepts MCP with an optional token and defaults the transport', () => {
    const res = CreateDataSourceSchema.parse({
      name: 'deploys',
      type: 'MCP',
      config: { serverUrl: 'http://localhost:8006/mcp' },
    });
    expect(res).toMatchObject({ type: 'MCP', config: { transport: 'streamable_http' } });
    expect(res.credentials).toBeUndefined();
    expect(
      CreateDataSourceSchema.safeParse({
        name: 'x',
        type: 'MCP',
        config: { serverUrl: 'http://h/mcp', transport: 'sse' },
      }).success,
    ).toBe(false);
    expect(
      CreateDataSourceSchema.safeParse({ name: 'x', type: 'MCP', config: { serverUrl: 'nope' } })
        .success,
    ).toBe(false);
  });

  it('requires owner, repo and a token for GITHUB', () => {
    const ok = CreateDataSourceSchema.safeParse({
      name: 'repo',
      type: 'GITHUB',
      config: { owner: 'acme', repo: 'shop', apiUrl: 'https://ghe.acme.test/api/v3' },
      credentials: { token: 'ghp_x' },
    });
    expect(ok.success).toBe(true);
    expect(
      CreateDataSourceSchema.safeParse({
        name: 'repo',
        type: 'GITHUB',
        config: { owner: 'acme', repo: 'shop' },
      }).success,
    ).toBe(false);
  });

  it('rejects CSV and unknown types (CSV is upload-only)', () => {
    for (const type of ['CSV', 'REST_API', 'ORACLE']) {
      expect(
        CreateDataSourceSchema.safeParse({ name: 'x', type, config: {}, credentials: {} }).success,
      ).toBe(false);
    }
  });
});

describe('validateUpdate', () => {
  it('merges config into the existing one and validates the result for the type', () => {
    const res = validateUpdate(
      'GITHUB',
      { owner: 'acme', repo: 'shop' },
      { config: { repo: 'web' } },
    );
    expect(res).toEqual({ ok: true, value: { config: { owner: 'acme', repo: 'web' } } });

    const bad = validateUpdate('MCP', { serverUrl: 'http://h/mcp' }, { config: { serverUrl: '' } });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.issues[0]!.path).toBe('config.serverUrl');
  });

  it('requires complete replacement credentials', () => {
    expect(validateUpdate('POSTGRESQL', {}, { credentials: { user: 'u' } }).ok).toBe(false);
    expect(validateUpdate('GITHUB', {}, { credentials: { token: 't' } })).toEqual({
      ok: true,
      value: { credentials: { token: 't' } },
    });
  });
});
