import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Validates (and coerces/defaults) an incoming value against a zod schema.
 * Errors come back as 400 with the flattened zod issues so clients can map
 * them onto form fields.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

/** zod schema -> OpenAPI 3 schema object for @nestjs/swagger decorators. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToOpenApi(schema: ZodTypeAny): Record<string, any> {
  // The cast sidesteps TS2589 (zod-to-json-schema's generic is very deep).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = zodToJsonSchema(schema as any, { target: 'openApi3' }) as Record<string, any>;
  delete out.$schema;
  return out;
}
