import { OrganizationRole } from '@helix/database';

/** OWNER > ADMIN > MEMBER > VIEWER. */
const RANK: Record<OrganizationRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function roleAtLeast(role: OrganizationRole, min: OrganizationRole): boolean {
  return RANK[role] >= RANK[min];
}
