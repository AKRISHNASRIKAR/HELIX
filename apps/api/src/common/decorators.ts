import {
  applyDecorators,
  Body,
  createParamDecorator,
  ExecutionContext,
  Query,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import type { OrganizationRole } from '@helix/database';
import type { AuthUser, HelixRequest, TenantContext } from './types';
import { ZodValidationPipe, zodToOpenApi } from './zod-validation.pipe';

export const IS_PUBLIC_KEY = 'helix:isPublic';
export const MIN_ROLE_KEY = 'helix:minRole';

/** Skips the global JwtAuthGuard (health, signup/login, internal routes). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Minimum organization role for a tenant-scoped handler. Without it,
 * TenantGuard defaults to VIEWER for reads and MEMBER for mutations, so a
 * VIEWER can never mutate anything even if a handler forgets this decorator.
 */
export const MinRole = (role: OrganizationRole) => SetMetadata(MIN_ROLE_KEY, role);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<HelixRequest>();
    if (!req.user) throw new UnauthorizedException();
    return req.user;
  },
);

export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<HelixRequest>();
    // Only reachable on routes guarded by TenantGuard; a missing context is a wiring bug.
    if (!req.tenant)
      throw new Error('Tenant context missing: is TenantGuard applied to this route?');
    return req.tenant;
  },
);

/**
 * `@ZodBody(Schema) body: T` validates the request body with zod and also
 * documents it in Swagger, so the schema is the single source of truth.
 */
export function ZodBody(schema: ZodTypeAny): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodValidationPipe(schema))(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) ApiBody({ schema: zodToOpenApi(schema) })(target, key, descriptor);
  };
}

/** Like ZodBody, for the whole query object. */
export function ZodQuery(schema: ZodTypeAny): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodValidationPipe(schema))(target, key, index);
  };
}

/** Swagger-only helper for documenting query params validated by ZodQuery. */
export const ApiQueries = (
  ...names: { name: string; required?: boolean; description?: string }[]
) =>
  applyDecorators(
    ...names.map((q) =>
      ApiQuery({ name: q.name, required: q.required ?? false, description: q.description }),
    ),
  );
