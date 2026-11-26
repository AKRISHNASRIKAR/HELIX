import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AUDIT_KEY, SKIP_AUDIT_KEY } from './audit.decorator';
import { AuthController } from '../auth/auth.controller';
import { DataSourcesController } from '../data-sources/data-sources.controller';
import { InternalController } from '../internal/internal.controller';
import { InvestigationsController } from '../investigations/investigations.controller';
import { MonitorsController } from '../monitors/monitors.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { OrganizationsController } from '../organizations/organizations.controller';
import { ProjectsController } from '../projects/projects.controller';

const CONTROLLERS = [
  AuthController,
  DataSourcesController,
  InternalController,
  InvestigationsController,
  MonitorsController,
  NotificationsController,
  OrganizationsController,
  ProjectsController,
];
const MUTATING = new Set([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

/** Guards the "every mutating endpoint writes an AuditLog row" rule at the source level. */
describe('audit coverage', () => {
  for (const controller of CONTROLLERS) {
    const proto = controller.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined || !MUTATING.has(method)) continue;
      it(`${controller.name}.${name} is annotated with @Audit (or @SkipAudit)`, () => {
        const audited =
          Reflect.getMetadata(AUDIT_KEY, handler) ?? Reflect.getMetadata(SKIP_AUDIT_KEY, handler);
        expect(audited).toBeTruthy();
      });
    }
  }
});
