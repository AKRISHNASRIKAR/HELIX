import { BaseEnvSchema, loadEnv } from '@helix/config';
import { z } from 'zod';

export const ApiEnvSchema = BaseEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
});
export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** Passed to Nest's ConfigModule.forRoot({ validate }) — fails fast on boot. */
export function validateEnv(config: Record<string, unknown>): ApiEnv {
  return loadEnv(ApiEnvSchema, config as Record<string, string | undefined>);
}
