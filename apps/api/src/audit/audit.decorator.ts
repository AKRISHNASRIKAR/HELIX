import { SetMetadata } from '@nestjs/common';
import type { HelixRequest } from '../common/types';

export const AUDIT_KEY = 'helix:audit';
export const SKIP_AUDIT_KEY = 'helix:skipAudit';

export interface AuditOptions {
  /** Dotted verb, e.g. `investigation.create`. */
  action: string;
  /** e.g. `investigation`, `data_source`. */
  resourceType: string;
  /**
   * How to find the affected resource id. Defaults to `response.id`, then
   * `req.params.id`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceId?: (response: any, req: HelixRequest) => string | null | undefined;
}

/** Marks a mutating handler for the global AuditInterceptor. */
export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);

/**
 * Explicit opt-out for mutating routes that are not user actions (e.g.
 * service-to-service progress callbacks, which already land in
 * InvestigationEvent). Keeps the "every mutation is audited" check honest.
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
