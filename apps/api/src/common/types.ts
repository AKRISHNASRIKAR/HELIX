import type { Request } from 'express';
import type { OrganizationRole } from '@helix/database';

/** What the JWT strategy attaches to `req.user`. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Validated tenant context attached by TenantGuard (never client-supplied). */
export interface TenantContext {
  organizationId: string;
  role: OrganizationRole;
}

/** Express request as seen by HELIX handlers (route params are always plain strings). */
export type HelixRequest = Request & {
  params: Record<string, string>;
  user?: AuthUser;
  tenant?: TenantContext;
};
