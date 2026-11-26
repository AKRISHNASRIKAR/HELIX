import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DataSourceStatus,
  DataSourceType,
  Prisma,
  type DataSource,
  type DataSourceCredential,
} from '@helix/database';
import type { ApiEnv } from '../config/env';
import { UpstreamError } from '../clients/http';
import {
  ConnectionSpec,
  IngestionClient,
  PreviewResult,
  ProfileResult,
} from '../clients/ingestion.client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDataSourceInput, isConfigurable, validateUpdate } from './data-source-types';
import { SecretsService } from './secrets.service';

export interface DataSourceListItem {
  id: string;
  name: string;
  type: DataSourceType;
  status: DataSourceStatus;
  statusMessage: string | null;
  tables: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
}

export interface DataSourceDetail extends DataSourceListItem {
  config: Record<string, unknown>;
  schemas: {
    tableName: string;
    columns: unknown;
    rowCountEstimate: number | null;
    discoveredAt: Date;
  }[];
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  schema?: string;
  sslmode?: string;
}

type DataSourceWithCredential = DataSource & { credential: DataSourceCredential | null };

/** Types the ingestion service can connect to (MCP and GITHUB since Phase 7). */
const CONNECTABLE: DataSourceType[] = [
  DataSourceType.POSTGRESQL,
  DataSourceType.CSV,
  DataSourceType.MCP,
  DataSourceType.GITHUB,
];

@Injectable()
export class DataSourcesService {
  private readonly logger = new Logger(DataSourcesService.name);
  readonly uploadDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly ingestion: IngestionClient,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.uploadDir = config.get('HELIX_UPLOAD_DIR', { infer: true });
  }

  // ------------------------------------------------------------------ reads

  async list(organizationId: string): Promise<DataSourceListItem[]> {
    const rows = await this.prisma.dataSource.findMany({
      where: { organizationId },
      include: { _count: { select: { schemas: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toListItem(r, r._count.schemas));
  }

  async detail(organizationId: string, id: string): Promise<DataSourceDetail> {
    const ds = await this.prisma.dataSource.findFirst({
      where: { id, organizationId },
      include: { schemas: { orderBy: { tableName: 'asc' } } },
    });
    if (!ds) throw new NotFoundException('Data source not found');
    return {
      ...this.toListItem(ds, ds.schemas.length),
      config: ds.connectionConfig as Record<string, unknown>,
      schemas: ds.schemas.map((s) => ({
        tableName: s.tableName,
        columns: s.columns,
        rowCountEstimate: s.rowCountEstimate,
        discoveredAt: s.discoveredAt,
      })),
    };
  }

  // ------------------------------------------------------------------ writes

  /**
   * POSTGRESQL, MCP or GITHUB from a validated body. Credentials (when any)
   * are encrypted into DataSourceCredential; config holds no secrets.
   */
  async create(organizationId: string, input: CreateDataSourceInput): Promise<DataSourceDetail> {
    const credentials = (input.credentials ?? {}) as Record<string, unknown>;
    const hasCredentials = Object.values(credentials).some((v) => v !== undefined);
    const ds = await this.prisma.dataSource.create({
      data: {
        organizationId,
        name: input.name,
        type: input.type,
        connectionConfig: input.config as unknown as Prisma.InputJsonObject,
        ...(hasCredentials ? { credential: { create: this.secrets.encrypt(credentials) } } : {}),
      },
    });
    await this.connectAndDiscover(ds.id);
    return this.detail(organizationId, ds.id);
  }

  /** `fileId` is the uuid the upload was stored under in HELIX_UPLOAD_DIR. */
  async createCsv(
    organizationId: string,
    input: { name: string; fileId: string; originalName: string },
  ): Promise<DataSourceDetail> {
    const ds = await this.prisma.dataSource.create({
      data: {
        organizationId,
        name: input.name,
        type: DataSourceType.CSV,
        connectionConfig: { fileId: input.fileId, originalName: input.originalName },
      },
    });
    await this.connectAndDiscover(ds.id);
    return this.detail(organizationId, ds.id);
  }

  async update(
    organizationId: string,
    id: string,
    input: {
      name?: string;
      config?: Record<string, unknown>;
      credentials?: Record<string, unknown>;
    },
  ): Promise<DataSourceDetail> {
    const ds = await this.findOwned(organizationId, id);
    const reconnect = input.config !== undefined || input.credentials !== undefined;
    let patch: { config?: Record<string, unknown>; credentials?: Record<string, unknown> } = {};
    if (reconnect) {
      if (!isConfigurable(ds.type)) {
        throw new BadRequestException(
          'Only POSTGRESQL, MCP and GITHUB data sources accept config/credentials updates',
        );
      }
      const checked = validateUpdate(
        ds.type,
        ds.connectionConfig as Record<string, unknown>,
        input,
      );
      if (!checked.ok) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          issues: checked.issues,
        });
      }
      patch = checked.value;
    }

    const data: Prisma.DataSourceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (patch.config !== undefined) {
      data.connectionConfig = patch.config as Prisma.InputJsonObject;
    }
    if (patch.credentials !== undefined) {
      const enc = this.secrets.encrypt(patch.credentials);
      data.credential = { upsert: { create: enc, update: enc } };
    }
    await this.prisma.dataSource.update({ where: { id }, data });

    if (reconnect) await this.connectAndDiscover(id);
    return this.detail(organizationId, id);
  }

  async sync(organizationId: string, id: string): Promise<DataSourceDetail> {
    await this.findOwned(organizationId, id);
    await this.connectAndDiscover(id);
    return this.detail(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const ds = await this.findOwned(organizationId, id);
    await this.prisma.dataSource.delete({ where: { id } });
    const filePath = this.filePathFor(ds);
    if (filePath) {
      await unlink(filePath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT')
          this.logger.warn(`Could not delete upload ${filePath}: ${err.message}`);
      });
    }
  }

  // ------------------------------------------------------------------ ingestion pass-throughs

  async preview(
    organizationId: string,
    id: string,
    table: string,
    limit?: number,
  ): Promise<PreviewResult> {
    const ds = await this.findOwned(organizationId, id);
    return this.callIngestion(() => this.ingestion.preview(this.connectionSpec(ds), table, limit));
  }

  async profile(organizationId: string, id: string, table: string): Promise<ProfileResult> {
    const ds = await this.findOwned(organizationId, id);
    return this.callIngestion(() => this.ingestion.profile(this.connectionSpec(ds), table));
  }

  // ------------------------------------------------------------------ connection resolution

  /** Spec A1: what the ingestion service needs to reach a data source. Decrypts credentials. */
  async resolveConnection(organizationId: string, id: string) {
    const ds = await this.findOwned(organizationId, id);
    const spec = this.connectionSpec(ds);
    return {
      id: ds.id,
      organizationId: ds.organizationId,
      type: spec.type,
      config: spec.config,
      credentials: spec.credentials ?? null,
      filePath: spec.filePath ?? null,
    };
  }

  connectionSpec(ds: DataSourceWithCredential): ConnectionSpec {
    if (!CONNECTABLE.includes(ds.type)) {
      throw new BadRequestException(`Data source type ${ds.type} is not connectable yet`);
    }
    return {
      type: ds.type as ConnectionSpec['type'],
      config: ds.connectionConfig as Record<string, unknown>,
      credentials: ds.credential ? this.secrets.decrypt(ds.credential) : null,
      filePath: this.filePathFor(ds),
    };
  }

  csvPath(fileId: string): string {
    return join(this.uploadDir, `${fileId}.csv`);
  }

  // ------------------------------------------------------------------ internals

  /**
   * Calls ingestion /connect and records the outcome on the row: CONNECTED
   * with fresh DataSourceSchema rows, or ERROR with a readable statusMessage.
   * Never throws for ingestion problems, so callers never 500 on a bad source.
   */
  private async connectAndDiscover(id: string): Promise<void> {
    const ds = await this.prisma.dataSource.findUniqueOrThrow({
      where: { id },
      include: { credential: true },
    });

    let outcome:
      | {
          ok: true;
          schemas: { tableName: string; columns: unknown; rowCountEstimate: number | null }[];
        }
      | { ok: false; error: string };
    try {
      const res = await this.ingestion.connect(this.connectionSpec(ds));
      outcome = res.ok
        ? { ok: true, schemas: Array.isArray(res.schemas) ? res.schemas : [] }
        : { ok: false, error: res.error || 'Connection failed' };
    } catch (err) {
      const reason =
        err instanceof UpstreamError && err.unreachable
          ? `Ingestion service unavailable (${err.message})`
          : `Connection check failed: ${(err as Error).message}`;
      outcome = { ok: false, error: reason };
    }

    if (!outcome.ok) {
      await this.prisma.dataSource.update({
        where: { id },
        data: { status: DataSourceStatus.ERROR, statusMessage: outcome.error.slice(0, 1000) },
      });
      return;
    }

    const now = new Date();
    const schemas = outcome.schemas;
    await this.prisma.$transaction([
      this.prisma.dataSourceSchema.deleteMany({ where: { dataSourceId: id } }),
      this.prisma.dataSourceSchema.createMany({
        data: schemas.map((s) => ({
          dataSourceId: id,
          tableName: s.tableName,
          columns: (s.columns ?? []) as Prisma.InputJsonValue,
          rowCountEstimate:
            typeof s.rowCountEstimate === 'number'
              ? Math.min(Math.round(s.rowCountEstimate), 2_147_483_647)
              : null,
          discoveredAt: now,
        })),
        skipDuplicates: true,
      }),
      this.prisma.dataSource.update({
        where: { id },
        data: { status: DataSourceStatus.CONNECTED, statusMessage: null, lastSyncedAt: now },
      }),
    ]);
  }

  private async callIngestion<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof UpstreamError) {
        if (err.unreachable || (err.status ?? 0) >= 500) {
          throw new BadGatewayException(`Ingestion service error: ${err.message}`);
        }
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }
  }

  private async findOwned(organizationId: string, id: string): Promise<DataSourceWithCredential> {
    const ds = await this.prisma.dataSource.findFirst({
      where: { id, organizationId },
      include: { credential: true },
    });
    if (!ds) throw new NotFoundException('Data source not found');
    return ds;
  }

  private filePathFor(ds: DataSource): string | null {
    if (ds.type !== DataSourceType.CSV) return null;
    const fileId = (ds.connectionConfig as Record<string, unknown>).fileId;
    return typeof fileId === 'string' ? this.csvPath(fileId) : null;
  }

  private toListItem(ds: DataSource, tables: number): DataSourceListItem {
    return {
      id: ds.id,
      name: ds.name,
      type: ds.type,
      status: ds.status,
      statusMessage: ds.statusMessage,
      tables,
      lastSyncedAt: ds.lastSyncedAt,
      createdAt: ds.createdAt,
    };
  }
}
