import { DataSourceType } from '@helix/database';
import { z } from 'zod';

/**
 * Per-type request schemas for data sources created from config (everything
 * except CSV, which is an upload). `config` is non-secret and stored in
 * DataSource.connectionConfig; `credentials` are encrypted (ADR-006).
 */
export const PostgresConfigSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  database: z.string().trim().min(1),
  schema: z.string().trim().min(1).optional(),
  sslmode: z.string().trim().min(1).optional(),
});
export const PostgresCredentialsSchema = z
  .object({ user: z.string().min(1), password: z.string() })
  .passthrough();

export const McpConfigSchema = z.object({
  serverUrl: z.string().trim().url(),
  transport: z.literal('streamable_http').default('streamable_http'),
  toolPrefixes: z.array(z.string().min(1)).min(1).optional(),
});
export const McpCredentialsSchema = z.object({ token: z.string().min(1).optional() });

export const GithubConfigSchema = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  apiUrl: z.string().trim().url().optional(),
});
export const GithubCredentialsSchema = z.object({ token: z.string().min(1) });

const Name = z.string().trim().min(1).max(200);

const CreatePostgres = z.object({
  name: Name,
  type: z.literal(DataSourceType.POSTGRESQL),
  config: PostgresConfigSchema,
  credentials: PostgresCredentialsSchema,
});
const CreateMcp = z.object({
  name: Name,
  type: z.literal(DataSourceType.MCP),
  config: McpConfigSchema,
  credentials: McpCredentialsSchema.optional(),
});
const CreateGithub = z.object({
  name: Name,
  type: z.literal(DataSourceType.GITHUB),
  config: GithubConfigSchema,
  credentials: GithubCredentialsSchema,
});

/** `POST /data-sources` body. A missing `type` means POSTGRESQL (Phase 2 clients). */
export const CreateDataSourceSchema = z.preprocess(
  (v) =>
    v && typeof v === 'object' && !Array.isArray(v) && (v as { type?: unknown }).type === undefined
      ? { ...v, type: DataSourceType.POSTGRESQL }
      : v,
  z.discriminatedUnion('type', [CreatePostgres, CreateMcp, CreateGithub]),
);
export type CreateDataSourceInput = z.infer<typeof CreateDataSourceSchema>;

/**
 * `PATCH /data-sources/:id` body. The type is only known once the row is
 * loaded, so config/credentials are checked per type by `validateUpdate`.
 */
export const UpdateDataSourceSchema = z
  .object({
    name: Name.optional(),
    config: z.record(z.unknown()).optional(),
    credentials: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateDataSourceInput = z.infer<typeof UpdateDataSourceSchema>;

/** Types whose config/credentials can be set through the API (CSV is upload-only). */
const CONFIG_SCHEMAS: Record<
  'POSTGRESQL' | 'MCP' | 'GITHUB',
  { config: z.ZodTypeAny; credentials: z.ZodTypeAny }
> = {
  [DataSourceType.POSTGRESQL]: {
    config: PostgresConfigSchema,
    credentials: PostgresCredentialsSchema,
  },
  [DataSourceType.MCP]: { config: McpConfigSchema, credentials: McpCredentialsSchema },
  [DataSourceType.GITHUB]: { config: GithubConfigSchema, credentials: GithubCredentialsSchema },
};

export type ConfigurableType = keyof typeof CONFIG_SCHEMAS;

export function isConfigurable(type: DataSourceType): type is ConfigurableType {
  return type in CONFIG_SCHEMAS;
}

export interface Issue {
  path: string;
  message: string;
}
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

function check(schema: z.ZodTypeAny, value: unknown, path: string) {
  const res = schema.safeParse(value);
  if (res.success) return { ok: true as const, value: res.data };
  return {
    ok: false as const,
    issues: res.error.issues.map((i) => ({
      path: [path, ...i.path].join('.'),
      message: i.message,
    })),
  };
}

/**
 * Validates a PATCH for a data source of `type`: the existing config merged
 * with the patch must be a complete, valid config, and replacement
 * credentials must be complete too.
 */
export function validateUpdate(
  type: ConfigurableType,
  existingConfig: Record<string, unknown>,
  patch: { config?: Record<string, unknown>; credentials?: Record<string, unknown> },
): ValidationResult<{ config?: Record<string, unknown>; credentials?: Record<string, unknown> }> {
  const schemas = CONFIG_SCHEMAS[type];
  const out: { config?: Record<string, unknown>; credentials?: Record<string, unknown> } = {};
  const issues: Issue[] = [];
  if (patch.config !== undefined) {
    const res = check(schemas.config, { ...existingConfig, ...patch.config }, 'config');
    if (res.ok) out.config = res.value as Record<string, unknown>;
    else issues.push(...res.issues);
  }
  if (patch.credentials !== undefined) {
    const res = check(schemas.credentials, patch.credentials, 'credentials');
    if (res.ok) out.credentials = res.value as Record<string, unknown>;
    else issues.push(...res.issues);
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: out };
}
