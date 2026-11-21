import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';

export const GLOBAL_PREFIX = 'api/v1';

/** Shared by main.ts and the e2e tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.enableCors({ origin: process.env.WEB_APP_URL ?? 'http://localhost:3000', credentials: true });
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: ['health'] });
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('HELIX API')
    .setDescription(
      'Public API for the HELIX investigation platform. Authenticate with `POST /api/v1/auth/login`, ' +
        'send the token as `Authorization: Bearer <token>`, and send `X-Organization-Id` on tenant-scoped routes.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Swagger UI at /docs, raw JSON at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
  });
}
