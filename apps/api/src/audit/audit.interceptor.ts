import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, Observable, concatMap, map } from 'rxjs';
import type { HelixRequest } from '../common/types';
import { AUDIT_KEY, AuditOptions } from './audit.decorator';
import { AuditService } from './audit.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Writes one AuditLog row after every successful handler annotated with
 * @Audit(). The write completes before the response is sent so "the action
 * happened" and "the action was audited" can't drift apart.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditOptions | undefined>(AUDIT_KEY, ctx.getHandler());
    if (!options || ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<HelixRequest>();

    return next
      .handle()
      .pipe(
        concatMap((response) =>
          from(this.audit.record(this.entryFor(options, req, response))).pipe(map(() => response)),
        ),
      );
  }

  private entryFor(options: AuditOptions, req: HelixRequest, response: unknown) {
    const body = (response ?? {}) as Record<string, unknown>;
    const resourceId =
      options.resourceId?.(response, req) ??
      (typeof body.id === 'string' ? body.id : undefined) ??
      req.params?.id ??
      null;
    const userId = req.user?.id ?? (options.resourceType === 'user' ? resourceId : null);
    const organizationId =
      req.tenant?.organizationId ?? (options.resourceType === 'organization' ? resourceId : null);
    return {
      action: options.action,
      resourceType: options.resourceType,
      resourceId,
      userId,
      organizationId: organizationId && UUID_RE.test(organizationId) ? organizationId : null,
      ipAddress: req.ip ?? null,
      metadata: { method: req.method, path: req.originalUrl ?? req.url },
    };
  }
}
