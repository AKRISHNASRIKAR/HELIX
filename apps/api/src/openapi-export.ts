/**
 * Writes docs/api/openapi.json without needing Postgres or Redis: the app is
 * created in Nest's preview mode, which builds the module/route graph from
 * metadata but never instantiates providers (so nothing connects anywhere).
 *
 *   pnpm --filter @helix/api openapi:export
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, buildOpenApiDocument } from './bootstrap';

async function main() {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  configureApp(app);
  const doc = buildOpenApiDocument(app);
  const out = resolve(__dirname, '../../../docs/api/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(doc.paths).length} paths to ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
