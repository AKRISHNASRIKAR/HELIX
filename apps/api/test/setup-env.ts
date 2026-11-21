import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// e2e tests always run against the dedicated helix_test database, never the
// dev one, regardless of what .env says (real env vars beat .env files).
process.env.DATABASE_URL =
  process.env.HELIX_TEST_DATABASE_URL ??
  'postgresql://helix:helix@localhost:5432/helix_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.HELIX_INTERNAL_TOKEN = 'e2e-internal-token';
process.env.HELIX_UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'helix-e2e-uploads-'));
delete process.env.HELIX_DEMO;
