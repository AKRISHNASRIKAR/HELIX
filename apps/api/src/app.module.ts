import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { InvestigationsModule } from './investigations/investigations.module';
import { DemoModule } from './demo/demo.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { TenantModule } from './tenant/tenant.module';
import { ClientsModule } from './clients/clients.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProjectsModule } from './projects/projects.module';
import { DataSourcesModule } from './data-sources/data-sources.module';
import { NotificationsModule } from './notifications/notifications.module';
import { InternalModule } from './internal/internal.module';
import { AgentsModule } from './agents/agents.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MonitorsModule } from './monitors/monitors.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { validateEnv } from './config/env';

// HELIX_DEMO=1 swaps every Postgres/Redis-backed module for fixture data, so
// the web app can be run and shown without any infrastructure (and without
// auth: the JWT guard lives in AuthModule, which demo mode doesn't load).
const DEMO = process.env.HELIX_DEMO === '1';

const PLATFORM_MODULES = [
  PrismaModule,
  RedisModule,
  ClientsModule,
  AuditModule,
  TenantModule,
  NotificationsModule,
  AuthModule,
  HealthModule,
  OrganizationsModule,
  ProjectsModule,
  DataSourcesModule,
  InvestigationsModule,
  InternalModule,
  AgentsModule,
  DashboardModule,
  MonitorsModule,
  AnalyticsModule,
];

@Module({
  imports: [
    // apps/api/.env first, then the repo-root .env (first match wins; real
    // environment variables always beat both).
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    // Rate limiting (section 21, Security): generous defaults for local dev,
    // tighten per-route with @Throttle() as endpoints are added.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ...(DEMO ? [DemoModule] : PLATFORM_MODULES),
  ],
})
export class AppModule {}
