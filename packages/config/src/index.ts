import { z } from 'zod';

/**
 * Base env schema every Node service needs. Services extend this with their
 * own required vars (see apps/api/src/config for an example) rather than
 * duplicating parsing logic.
 */
export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
export type BaseEnv = z.infer<typeof BaseEnvSchema>;

/**
 * Parses `process.env` against a schema and fails fast with a readable error
 * instead of letting an undefined var surface as a confusing runtime bug later.
 */
export function loadEnv<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  source: Record<string, string | undefined> = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
