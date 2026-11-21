import { resolve } from 'node:path';
import { BaseEnvSchema, loadEnv } from '@helix/config';
import { z } from 'zod';

// Dev-only defaults. Convenient locally, refused outright in production so a
// forgotten env var can't silently ship a guessable signing/encryption key.
export const DEV_JWT_SECRET = 'dev-only-change-me-please-32-chars-min';
export const DEV_SECRETS_KEY = 'ZGV2LW9ubHktc2VjcmV0cy1rZXktMzItYnl0ZXMhISE=';

export const ApiEnvSchema = BaseEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),

  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().min(1).default('12h'),
  // Shared secret for service-to-service calls (header x-helix-internal-token).
  HELIX_INTERNAL_TOKEN: z.string().min(1).default('dev-internal-token'),
  // Base64 AES-256 key for data source credentials; must decode to 32 bytes.
  HELIX_SECRETS_KEY: z
    .string()
    .default(DEV_SECRETS_KEY)
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'must be a base64-encoded 32-byte key',
    }),
  HELIX_UPLOAD_DIR: z
    .string()
    .default('.data/uploads')
    .transform((v) => resolve(process.cwd(), v)),

  INGESTION_SERVICE_URL: z.string().url().default('http://localhost:8004'),
  AGENT_RUNTIME_URL: z.string().url().default('http://localhost:8001'),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (env.JWT_SECRET === DEV_JWT_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'dev default not allowed in production',
    });
  }
  if (env.HELIX_SECRETS_KEY === DEV_SECRETS_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['HELIX_SECRETS_KEY'],
      message: 'dev default not allowed in production',
    });
  }
});
export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** Passed to Nest's ConfigModule.forRoot({ validate }). Fails fast on boot. */
export function validateEnv(config: Record<string, unknown>): ApiEnv {
  return loadEnv(ApiEnvSchema, config as Record<string, string | undefined>);
}
